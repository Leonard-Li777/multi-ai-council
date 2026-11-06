import { defineContentScript } from 'wxt/utils/define-content-script';
import { chatGLMAdapter } from '../lib/adapters/chatglm.adapter';
import { CONTENT_PORT_NAME, setupPortWithHeartbeat, type PortMessage } from '../lib/messaging/port';
import { NetworkListener } from '../lib/interceptor/network-listener';
import { createAdapterBridge } from '../lib/interceptor/adapter-bridge';

export default defineContentScript({
  matches: ['https://chatglm.cn/*'],
  runAt: 'document_idle',
  main() {
    console.log('[Multi-AI Council] ChatGLM content script initialized');

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
      if (msg.type === 'DISPATCH_PROMPT' && msg.payload.siteName === 'ChatGLM') {
        const { jobId, prompt, isContinuation } = msg.payload;
        if (isDispatching && lastHandledJobId === jobId) {
          console.warn(`[ChatGLMContent] Already dispatching Job ${jobId}, ignoring duplicate`);
          return;
        }
        isDispatching = true;
        lastHandledJobId = jobId;
        currentJobId = jobId;

        try {
          const blocker = await chatGLMAdapter.checkBlocker();
          if (blocker === 'CAPTCHA') {
            send({
              type: 'STATUS_CHANGE',
              payload: { siteName: 'ChatGLM', jobId, status: 'BLOCKED_CAPTCHA', errorReason: '检测到验证码，请人工通过' },
            });
            return;
          }
          if (blocker === 'NOT_LOGGED_IN') {
            send({
              type: 'STATUS_CHANGE',
              payload: { siteName: 'ChatGLM', jobId, status: 'BLOCKED_LOGIN', errorReason: '检测到未登录状态，请先登录' },
            });
            return;
          }
          if (blocker === 'RATE_LIMIT') {
            send({
              type: 'STATUS_CHANGE',
              payload: { siteName: 'ChatGLM', jobId, status: 'RATE_LIMITED', errorReason: '智谱清言请求频次限制' },
            });
            return;
          }

          if (!isContinuation) {
            await chatGLMAdapter.createNewChat();
          }

          send({
            type: 'STATUS_CHANGE',
            payload: { siteName: 'ChatGLM', jobId, status: 'SENDING' },
          });

          const sent = await chatGLMAdapter.sendPrompt(prompt);
          if (!sent) {
            send({
              type: 'STATUS_CHANGE',
              payload: { siteName: 'ChatGLM', jobId, status: 'FAILED', errorReason: '输入框注入或点击发送失败' },
            });
            return;
          }

          const validated = await chatGLMAdapter.validateSubmission();
          if (!validated) {
            send({
              type: 'STATUS_CHANGE',
              payload: { siteName: 'ChatGLM', jobId, status: 'FAILED', errorReason: '提交后会话未响应' },
            });
            return;
          }

          // 6. 标记为 STREAMING 并启动双轨监听（网络层优先，DOM 降级兜底）
          send({
            type: 'STATUS_CHANGE',
            payload: { siteName: 'ChatGLM', jobId, status: 'STREAMING' },
          });

          if (stopListening) {
            stopListening();
            stopListening = null;
          }
          networkListener?.destroy();
          networkBridgeDestroy?.();

          // 创建 AdapterBridge：StreamOrchestrator 语义事件 + DOM 伴生哨兵 → PortMessage
          const bridge = createAdapterBridge({
            siteName: 'ChatGLM',
            jobId,
            sendFn: send,
            url: 'https://chatglm.cn/chatglm/assistant-api/v1/chat/completion',
            prompt,
          });
          networkBridgeDestroy = bridge.destroy;

          // 核心机制：立即挂载 DOM 伴生哨兵（实时流式互补 + 终极 2.5s 静默判定收敛）
          stopListening = chatGLMAdapter.listenGeneration(
            (snapshot, cleaned) => {
              bridge.handleDomUpdate(snapshot, cleaned);
            },
            (finalCleaned) => {
              const finalUrl = chatGLMAdapter.getConversationUrl();
              bridge.handleDomDone(finalCleaned, finalUrl);
            }
          );

          bridge.orchestrator.dispatchPrompt(jobId, prompt);

          networkListener = new NetworkListener({
            allowedOrigin: 'https://chatglm.cn',
            onValidFrame: (frame) => {
              bridge.orchestrator.handleStreamFrame(frame);
            },
            onInvalidFrame: (frame, reason) => {
              console.warn(`[ChatGLMContent] Invalid frame rejected: ${reason}`, frame.streamId);
            },
          });
          networkListener.start();
        } catch (err) {
          console.error('[ChatGLMContent] Dispatch error:', err);
          send({
            type: 'STATUS_CHANGE',
            payload: {
              siteName: 'ChatGLM',
              jobId,
              status: 'FAILED',
              errorReason: err instanceof Error ? err.message : String(err),
            },
          });
        } finally {
          isDispatching = false;
        }
      } else if (msg.type === 'RECOVER_SITE' && msg.payload.siteName === 'ChatGLM') {
        const { jobId, prompt } = msg.payload;
        currentJobId = jobId;
        console.log(`[ChatGLMContent] Executing auto-recovery for Job ${jobId}`);

        try {
          if (stopListening) stopListening();

          const result = await chatGLMAdapter.autoRecoverAndContinue(
            prompt,
            (snapshot, cleaned) => {
              send({
                type: 'STREAM_UPDATE',
                payload: { siteName: 'ChatGLM', jobId, snapshot, cleaned, isFinished: false },
              });
            },
            (finalCleaned) => {
              const finalUrl = chatGLMAdapter.getConversationUrl();
              send({
                type: 'STREAM_UPDATE',
                payload: { siteName: 'ChatGLM', jobId, snapshot: finalCleaned, cleaned: finalCleaned, isFinished: true },
              });
              send({
                type: 'STATUS_CHANGE',
                payload: { siteName: 'ChatGLM', jobId, status: 'DONE', conversationUrl: finalUrl },
              });
            }
          );

          if (result === 'STREAMING') {
            send({ type: 'STATUS_CHANGE', payload: { siteName: 'ChatGLM', jobId, status: 'STREAMING' } });
          } else if (result === 'FAILED') {
            send({
              type: 'STATUS_CHANGE',
              payload: { siteName: 'ChatGLM', jobId, status: 'FAILED', errorReason: '自愈重试未成功，请检查页面输入框状态' },
            });
          }
        } catch (err) {
          console.error('[ChatGLMContent] Recovery error:', err);
          send({
            type: 'STATUS_CHANGE',
            payload: { siteName: 'ChatGLM', jobId, status: 'FAILED', errorReason: String(err) },
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
            siteName: 'ChatGLM',
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
        sendResponse({ type: 'PONG', siteName: 'ChatGLM', ready: true });
        return false;
      }
      if (msg.type === 'DISPATCH_PROMPT' || msg.type === 'DISPATCH_SYNTHESIS_PROMPT' || msg.type === 'RECOVER_SITE') {
        sendResponse({ success: true, siteName: 'ChatGLM', received: true });
        handleIncomingMessage(msg);
        return false;
      }
      return false;
    };
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener(runtimeMessageListener);
    }

    let lastUrl = window.location.href;
    const urlCheckInterval = window.setInterval(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        send({
          type: 'UPDATE_CONVERSATION_URL',
          payload: {
            siteName: 'ChatGLM',
            jobId: currentJobId || undefined,
            conversationUrl: lastUrl,
          },
        });
      }
    }, 1000);

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
