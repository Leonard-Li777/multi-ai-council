import { defineContentScript } from 'wxt/utils/define-content-script';
import { deepSeekAdapter } from '../lib/adapters/deepseek.adapter';
import { CONTENT_PORT_NAME, setupPortWithHeartbeat, type PortMessage } from '../lib/messaging/port';

export default defineContentScript({
  matches: ['https://chat.deepseek.com/*'],
  runAt: 'document_idle',
  main() {
    console.log('[Multi-AI Council] DeepSeek content script initialized');

    let stopListening: (() => void) | null = null;
    let currentJobId: string | null = null;
    let sendFn: ((msg: PortMessage) => void) | null = null;
    const send = (msg: PortMessage) => {
      if (sendFn) sendFn(msg);
    };

    const handleIncomingMessage = async (msg: PortMessage) => {
      if (msg.type === 'DISPATCH_PROMPT' && msg.payload.siteName === 'DeepSeek') {
        const { jobId, prompt, isContinuation } = msg.payload;
        currentJobId = jobId;

        console.log(`[DeepSeekContent] Received prompt for Job ${jobId}, continuation=${isContinuation}`);

        try {
          // 1. 检查页面阻断状态
          const blocker = await deepSeekAdapter.checkBlocker();
          if (blocker === 'CAPTCHA') {
            send({
              type: 'STATUS_CHANGE',
              payload: { siteName: 'DeepSeek', jobId, status: 'BLOCKED_CAPTCHA', errorReason: '检测到人机验证，请人工通过' },
            });
            return;
          }
          if (blocker === 'NOT_LOGGED_IN') {
            send({
              type: 'STATUS_CHANGE',
              payload: { siteName: 'DeepSeek', jobId, status: 'BLOCKED_LOGIN', errorReason: '检测到未登录状态，请先登录' },
            });
            return;
          }

          // 2. 若明确为新会话，执行新建
          if (!isContinuation) {
            await deepSeekAdapter.createNewChat();
          }

          // 3. 标记状态为 SENDING
          send({
            type: 'STATUS_CHANGE',
            payload: { siteName: 'DeepSeek', jobId, status: 'SENDING' },
          });

          // 4. 模拟写入与提交
          const sent = await deepSeekAdapter.sendPrompt(prompt);
          if (!sent) {
            send({
              type: 'STATUS_CHANGE',
              payload: { siteName: 'DeepSeek', jobId, status: 'FAILED', errorReason: '输入框注入或点击发送失败' },
            });
            return;
          }

          // 5. 校验提交状态
          const validated = await deepSeekAdapter.validateSubmission();
          if (!validated) {
            send({
              type: 'STATUS_CHANGE',
              payload: { siteName: 'DeepSeek', jobId, status: 'FAILED', errorReason: '提交后会话未响应' },
            });
            return;
          }

          // 6. 标记为 STREAMING 并启动监听
          send({
            type: 'STATUS_CHANGE',
            payload: { siteName: 'DeepSeek', jobId, status: 'STREAMING' },
          });

          if (stopListening) {
            stopListening();
          }

          stopListening = deepSeekAdapter.listenGeneration(
            (snapshot, cleaned) => {
              send({
                type: 'STREAM_UPDATE',
                payload: {
                  siteName: 'DeepSeek',
                  jobId,
                  snapshot,
                  cleaned,
                  isFinished: false,
                },
              });
            },
            (finalCleaned) => {
              const finalUrl = deepSeekAdapter.getConversationUrl();
              send({
                type: 'STREAM_UPDATE',
                payload: {
                  siteName: 'DeepSeek',
                  jobId,
                  snapshot: finalCleaned,
                  cleaned: finalCleaned,
                  isFinished: true,
                },
              });

              send({
                type: 'STATUS_CHANGE',
                payload: {
                  siteName: 'DeepSeek',
                  jobId,
                  status: 'DONE',
                  conversationUrl: finalUrl,
                },
              });
            }
          );
        } catch (err) {
          console.error('[DeepSeekContent] Dispatch error:', err);
          send({
            type: 'STATUS_CHANGE',
            payload: {
              siteName: 'DeepSeek',
              jobId,
              status: 'FAILED',
              errorReason: err instanceof Error ? err.message : String(err),
            },
          });
        }
      } else if (msg.type === 'DISPATCH_SYNTHESIS_PROMPT') {
        const { jobId, metaPrompt } = msg.payload;
        currentJobId = jobId;

        console.log(`[DeepSeekContent] Received SYNTHESIS prompt for Job ${jobId}`);

        // 1. 检查页面阻断状态
        const blocker = await deepSeekAdapter.checkBlocker();
        if (blocker === 'CAPTCHA') {
          send({
            type: 'SYNTHESIS_STATUS_CHANGE',
            payload: { jobId, status: 'BLOCKED_CAPTCHA', errorReason: '终审检测到人机验证，请人工通过' },
          });
          return;
        }
        if (blocker === 'NOT_LOGGED_IN') {
          send({
            type: 'SYNTHESIS_STATUS_CHANGE',
            payload: { jobId, status: 'BLOCKED_LOGIN', errorReason: '终审检测到未登录状态，请先登录 DeepSeek' },
          });
          return;
        }

        // 2. 标记状态为 SENDING
        send({
          type: 'SYNTHESIS_STATUS_CHANGE',
          payload: { jobId, status: 'SENDING' },
        });

        // 3. 模拟写入并提交
        const sent = await deepSeekAdapter.sendPrompt(metaPrompt);
        if (!sent) {
          send({
            type: 'SYNTHESIS_STATUS_CHANGE',
            payload: { jobId, status: 'FAILED', errorReason: '终审提示词注入或点击发送失败' },
          });
          return;
        }

        // 4. 校验提交状态
        const validated = await deepSeekAdapter.validateSubmission();
        if (!validated) {
          send({
            type: 'SYNTHESIS_STATUS_CHANGE',
            payload: { jobId, status: 'FAILED', errorReason: '终审提交后页面无响应' },
          });
          return;
        }

        // 5. 标记为 STREAMING 并监听生成
        send({
          type: 'SYNTHESIS_STATUS_CHANGE',
          payload: { jobId, status: 'STREAMING' },
        });

        if (stopListening) {
          stopListening();
        }

        stopListening = deepSeekAdapter.listenGeneration(
          (snapshot) => {
            send({
              type: 'SYNTHESIS_STREAM_UPDATE',
              payload: {
                jobId,
                snapshot,
                isFinished: false,
              },
            });
          },
          (finalCleaned) => {
            send({
              type: 'SYNTHESIS_STREAM_UPDATE',
              payload: {
                jobId,
                snapshot: finalCleaned,
                isFinished: true,
              },
            });

            send({
              type: 'SYNTHESIS_STATUS_CHANGE',
              payload: {
                jobId,
                status: 'DONE',
                finalMarkdown: finalCleaned,
              },
            });
          }
        );
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
            siteName: 'DeepSeek',
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
        sendResponse({ type: 'PONG', siteName: 'DeepSeek', ready: true });
        return false;
      }
      if (msg.type === 'DISPATCH_PROMPT' || msg.type === 'DISPATCH_SYNTHESIS_PROMPT') {
        sendResponse({ success: true, siteName: 'DeepSeek', received: true });
        handleIncomingMessage(msg);
        return false;
      }
      return false;
    };
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener(runtimeMessageListener);
    }

    // 监听 URL 变化（如 DeepSeek 从 / 变为 /a/chat/s/:id），实时同步会话引用
    let lastUrl = window.location.href;
    const urlCheckInterval = window.setInterval(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        send({
          type: 'UPDATE_CONVERSATION_URL',
          payload: {
            siteName: 'DeepSeek',
            jobId: currentJobId || undefined,
            conversationUrl: lastUrl,
          },
        });
      }
    }, 1000);

    // 卸载时清理监听
    window.addEventListener('beforeunload', () => {
      if (stopListening) stopListening();
      clearInterval(urlCheckInterval);
      if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
        chrome.runtime.onMessage.removeListener(runtimeMessageListener);
      }
    });
  },
});
