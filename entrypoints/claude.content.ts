import { defineContentScript } from 'wxt/utils/define-content-script';
import { claudeAdapter } from '../lib/adapters/claude.adapter';
import { CONTENT_PORT_NAME, setupPortWithHeartbeat, type PortMessage } from '../lib/messaging/port';
import { NetworkListener } from '../lib/interceptor/network-listener';
import { createAdapterBridge } from '../lib/interceptor/adapter-bridge';

export default defineContentScript({
  matches: ['https://claude.ai/*'],
  runAt: 'document_idle',
  main() {
    console.log('[Multi-AI Council] Claude content script initialized');

    let stopListening: (() => void) | null = null;
    let currentJobId: string | null = null;
    let isDispatching = false;
    let lastHandledJobId = '';
    let sendFn: ((msg: PortMessage) => void) | null = null;
    const send = (msg: PortMessage) => {
      if (sendFn) sendFn(msg);
    };

    // --- 网络层拦截集成 (双轨融合) ---
    let networkListener: NetworkListener | null = null;
    let networkBridgeDestroy: (() => void) | null = null;

    const handleIncomingMessage = async (msg: PortMessage) => {
      if (msg.type === 'DISPATCH_PROMPT' && msg.payload.siteName === 'Claude') {
        const { jobId, prompt, isContinuation } = msg.payload;
        if (isDispatching && lastHandledJobId === jobId) {
          console.warn(`[ClaudeContent] Already dispatching Job ${jobId}, ignoring duplicate`);
          return;
        }
        isDispatching = true;
        lastHandledJobId = jobId;
        currentJobId = jobId;

        console.log(`[ClaudeContent] Received prompt for Job ${jobId}, continuation=${isContinuation}`);

        try {
          // 1. 检查页面阻断状态
          const blocker = await claudeAdapter.checkBlocker();
          if (blocker === 'CAPTCHA') {
            send({
              type: 'STATUS_CHANGE',
              payload: {
                siteName: 'Claude',
                jobId,
                status: 'BLOCKED_CAPTCHA',
                errorReason: '检测到 Cloudflare 人机验证，请人工通过',
              },
            });
            return;
          }
          if (blocker === 'NOT_LOGGED_IN') {
            send({
              type: 'STATUS_CHANGE',
              payload: {
                siteName: 'Claude',
                jobId,
                status: 'BLOCKED_LOGIN',
                errorReason: '检测到未登录状态，请先登录 Claude',
              },
            });
            return;
          }
          if (blocker === 'RATE_LIMIT') {
            send({
              type: 'STATUS_CHANGE',
              payload: {
                siteName: 'Claude',
                jobId,
                status: 'RATE_LIMITED',
                errorReason: 'Claude 当前遭遇额度或频次限制',
              },
            });
            return;
          }

          // 2. 若明确为新会话，执行新建
          if (!isContinuation) {
            await claudeAdapter.createNewChat();
          }

          // 3. 标记状态为 SENDING
          send({
            type: 'STATUS_CHANGE',
            payload: { siteName: 'Claude', jobId, status: 'SENDING' },
          });

          // 4. 模拟写入与提交
          const sent = await claudeAdapter.sendPrompt(prompt);
          if (!sent) {
            send({
              type: 'STATUS_CHANGE',
              payload: { siteName: 'Claude', jobId, status: 'FAILED', errorReason: 'ProseMirror 输入框注入或点击发送失败' },
            });
            return;
          }

          // 5. 校验提交状态
          const validated = await claudeAdapter.validateSubmission();
          if (!validated) {
            send({
              type: 'STATUS_CHANGE',
              payload: { siteName: 'Claude', jobId, status: 'FAILED', errorReason: '提交后会话未响应' },
            });
            return;
          }

          // 6. 标记为 STREAMING 并启动双轨伴生监听（网络层高速捕获 + DOM 伴生哨兵终极判定）
          send({
            type: 'STATUS_CHANGE',
            payload: { siteName: 'Claude', jobId, status: 'STREAMING' },
          });

          if (stopListening) {
            stopListening();
            stopListening = null;
          }
          networkListener?.destroy();
          networkBridgeDestroy?.();

          // 创建 AdapterBridge：StreamOrchestrator 语义事件 + DOM 伴生哨兵 → PortMessage
          const bridge = createAdapterBridge({
            siteName: 'Claude',
            jobId,
            sendFn: send,
            url: 'https://claude.ai/api/organizations/current/completion',
            prompt,
          });
          networkBridgeDestroy = bridge.destroy;

          // 核心机制：立即挂载 DOM 伴生哨兵（实时流式互补 + 终极 2.5s 静默判定收敛）
          stopListening = claudeAdapter.listenGeneration(
            (snapshot, cleaned) => {
              bridge.handleDomUpdate(snapshot, cleaned);
            },
            (finalCleaned) => {
              const finalUrl = claudeAdapter.getConversationUrl();
              bridge.handleDomDone(finalCleaned, finalUrl);
            }
          );

          bridge.orchestrator.dispatchPrompt(jobId, prompt);

          networkListener = new NetworkListener({
            allowedOrigin: 'https://claude.ai',
            onValidFrame: (frame) => {
              bridge.orchestrator.handleStreamFrame(frame);
            },
            onInvalidFrame: (frame, reason) => {
              console.warn(`[ClaudeContent] Invalid frame rejected: ${reason}`, frame.streamId);
            },
          });
          networkListener.start();
        } catch (err) {
          console.error('[ClaudeContent] Dispatch error:', err);
          send({
            type: 'STATUS_CHANGE',
            payload: {
              siteName: 'Claude',
              jobId,
              status: 'FAILED',
              errorReason: err instanceof Error ? err.message : String(err),
            },
          });
        } finally {
          isDispatching = false;
        }
      } else if (msg.type === 'RECOVER_SITE' && msg.payload.siteName === 'Claude') {
        const { jobId, prompt } = msg.payload;
        currentJobId = jobId;
        console.log(`[ClaudeContent] Executing auto-recovery for Job ${jobId}`);

        try {
          if (stopListening) stopListening();

          const result = await claudeAdapter.autoRecoverAndContinue(
            prompt,
            (snapshot, cleaned) => {
              send({
                type: 'STREAM_UPDATE',
                payload: { siteName: 'Claude', jobId, snapshot, cleaned, isFinished: false },
              });
            },
            (finalCleaned) => {
              const finalUrl = claudeAdapter.getConversationUrl();
              send({
                type: 'STREAM_UPDATE',
                payload: { siteName: 'Claude', jobId, snapshot: finalCleaned, cleaned: finalCleaned, isFinished: true },
              });
              send({
                type: 'STATUS_CHANGE',
                payload: { siteName: 'Claude', jobId, status: 'DONE', conversationUrl: finalUrl },
              });
            }
          );

          if (result === 'STREAMING') {
            send({ type: 'STATUS_CHANGE', payload: { siteName: 'Claude', jobId, status: 'STREAMING' } });
          } else if (result === 'FAILED') {
            send({
              type: 'STATUS_CHANGE',
              payload: { siteName: 'Claude', jobId, status: 'FAILED', errorReason: '自愈重试未成功，请检查页面输入框状态' },
            });
          }
        } catch (err) {
          console.error('[ClaudeContent] Recovery error:', err);
          send({
            type: 'STATUS_CHANGE',
            payload: { siteName: 'Claude', jobId, status: 'FAILED', errorReason: String(err) },
          });
        }
      }
    };

    // 建立带心跳的长连接并在连接或重连时自动注册 CONTENT_READY
    const { send: boundSend } = setupPortWithHeartbeat(
      CONTENT_PORT_NAME,
      handleIncomingMessage,
      undefined,
      (readySend) => {
        readySend({
          type: 'CONTENT_READY',
          payload: {
            siteName: 'Claude',
            url: window.location.href,
          },
        });
      }
    );
    sendFn = boundSend;

    // 兼听 runtime.onMessage（支持 tabs.sendMessage 直达调度与存活心跳）
    const runtimeMessageListener = (
      msg: PortMessage,
      _sender: chrome.runtime.MessageSender,
      sendResponse: (response?: any) => void
    ) => {
      if (msg.type === 'PING') {
        sendResponse({ type: 'PONG', siteName: 'Claude', ready: true });
        return false;
      }
      if (msg.type === 'DISPATCH_PROMPT' || msg.type === 'DISPATCH_SYNTHESIS_PROMPT' || msg.type === 'RECOVER_SITE') {
        sendResponse({ success: true, siteName: 'Claude', received: true });
        handleIncomingMessage(msg);
        return false;
      }
      return false;
    };
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener(runtimeMessageListener);
    }

    // 监听 URL 变化（如 Claude 从 / 或 /new 变为 /chat/:id），实时同步会话引用
    let lastUrl = window.location.href;
    const urlCheckInterval = window.setInterval(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        send({
          type: 'UPDATE_CONVERSATION_URL',
          payload: {
            siteName: 'Claude',
            jobId: currentJobId || undefined,
            conversationUrl: lastUrl,
          },
        });
      }
    }, 1000);

    // 卸载时清理监听
    window.addEventListener('beforeunload', () => {
      if (stopListening) stopListening();
      networkListener?.destroy();
      networkBridgeDestroy?.();
      clearInterval(urlCheckInterval);
      if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
        chrome.runtime.onMessage.removeListener(runtimeMessageListener);
      }
    });
  },
});
