import { defineContentScript } from 'wxt/utils/define-content-script';
import { geminiAdapter } from '../lib/adapters/gemini.adapter';
import { CONTENT_PORT_NAME, setupPortWithHeartbeat, type PortMessage } from '../lib/messaging/port';

export default defineContentScript({
  matches: ['https://gemini.google.com/*'],
  runAt: 'document_idle',
  main() {
    console.log('[Multi-AI Council] Gemini content script initialized');

    let stopListening: (() => void) | null = null;
    let currentJobId: string | null = null;
    let sendFn: ((msg: PortMessage) => void) | null = null;
    const send = (msg: PortMessage) => {
      if (sendFn) sendFn(msg);
    };

    const handleIncomingMessage = async (msg: PortMessage) => {
      if (msg.type === 'DISPATCH_PROMPT' && msg.payload.siteName === 'Gemini') {
        const { jobId, prompt, isContinuation } = msg.payload;
        currentJobId = jobId;

        const blocker = await geminiAdapter.checkBlocker();
        if (blocker === 'CAPTCHA') {
          send({
            type: 'STATUS_CHANGE',
            payload: { siteName: 'Gemini', jobId, status: 'BLOCKED_CAPTCHA', errorReason: '检测到验证码，请人工通过' },
          });
          return;
        }
        if (blocker === 'NOT_LOGGED_IN') {
          send({
            type: 'STATUS_CHANGE',
            payload: { siteName: 'Gemini', jobId, status: 'BLOCKED_LOGIN', errorReason: '检测到 Google 未登录状态，请先登录' },
          });
          return;
        }
        if (blocker === 'RATE_LIMIT') {
          send({
            type: 'STATUS_CHANGE',
            payload: { siteName: 'Gemini', jobId, status: 'RATE_LIMITED', errorReason: 'Gemini 请求频次限制' },
          });
          return;
        }

        if (!isContinuation) {
          await geminiAdapter.createNewChat();
        }

        send({
          type: 'STATUS_CHANGE',
          payload: { siteName: 'Gemini', jobId, status: 'SENDING' },
        });

        const sent = await geminiAdapter.sendPrompt(prompt);
        if (!sent) {
          send({
            type: 'STATUS_CHANGE',
            payload: { siteName: 'Gemini', jobId, status: 'FAILED', errorReason: 'Quill 输入框注入或点击发送失败' },
          });
          return;
        }

        const validated = await geminiAdapter.validateSubmission();
        if (!validated) {
          send({
            type: 'STATUS_CHANGE',
            payload: { siteName: 'Gemini', jobId, status: 'FAILED', errorReason: '提交后会话未响应' },
          });
          return;
        }

        send({
          type: 'STATUS_CHANGE',
          payload: { siteName: 'Gemini', jobId, status: 'STREAMING' },
        });

        if (stopListening) stopListening();

        stopListening = geminiAdapter.listenGeneration(
          (snapshot, cleaned) => {
            send({
              type: 'STREAM_UPDATE',
              payload: {
                siteName: 'Gemini',
                jobId,
                snapshot,
                cleaned,
                isFinished: false,
              },
            });
          },
          (finalCleaned) => {
            const finalUrl = geminiAdapter.getConversationUrl();
            send({
              type: 'STREAM_UPDATE',
              payload: {
                siteName: 'Gemini',
                jobId,
                snapshot: finalCleaned,
                cleaned: finalCleaned,
                isFinished: true,
              },
            });

            send({
              type: 'STATUS_CHANGE',
              payload: {
                siteName: 'Gemini',
                jobId,
                status: 'DONE',
                conversationUrl: finalUrl,
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
            siteName: 'Gemini',
            url: window.location.href,
          },
        });
      }
    );
    sendFn = boundSend;

    // 兼听 runtime.onMessage（支持 tabs.sendMessage 直达调度）
    const runtimeMessageListener = (msg: PortMessage) => {
      handleIncomingMessage(msg);
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
            siteName: 'Gemini',
            jobId: currentJobId || undefined,
            conversationUrl: lastUrl,
          },
        });
      }
    }, 1000);

    window.addEventListener('beforeunload', () => {
      if (stopListening) stopListening();
      clearInterval(urlCheckInterval);
      if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
        chrome.runtime.onMessage.removeListener(runtimeMessageListener);
      }
    });
  },
});
