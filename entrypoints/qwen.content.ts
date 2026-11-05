import { defineContentScript } from 'wxt/utils/define-content-script';
import { qwenAdapter } from '../lib/adapters/qwen.adapter';
import { CONTENT_PORT_NAME, setupPortWithHeartbeat, type PortMessage } from '../lib/messaging/port';

export default defineContentScript({
  matches: ['https://chat.qwen.ai/*'],
  runAt: 'document_idle',
  main() {
    console.log('[Multi-AI Council] Qwen content script initialized');

    let stopListening: (() => void) | null = null;
    let currentJobId: string | null = null;
    let sendFn: ((msg: PortMessage) => void) | null = null;
    const send = (msg: PortMessage) => {
      if (sendFn) sendFn(msg);
    };

    const handleIncomingMessage = async (msg: PortMessage) => {
      if (msg.type === 'DISPATCH_PROMPT' && msg.payload.siteName === 'Qwen') {
        const { jobId, prompt, isContinuation } = msg.payload;
        currentJobId = jobId;

        const blocker = await qwenAdapter.checkBlocker();
        if (blocker === 'CAPTCHA') {
          send({
            type: 'STATUS_CHANGE',
            payload: { siteName: 'Qwen', jobId, status: 'BLOCKED_CAPTCHA', errorReason: '检测到人机验证，请人工通过' },
          });
          return;
        }
        if (blocker === 'NOT_LOGGED_IN') {
          send({
            type: 'STATUS_CHANGE',
            payload: { siteName: 'Qwen', jobId, status: 'BLOCKED_LOGIN', errorReason: '检测到未登录状态，请先登录' },
          });
          return;
        }
        if (blocker === 'RATE_LIMIT') {
          send({
            type: 'STATUS_CHANGE',
            payload: { siteName: 'Qwen', jobId, status: 'RATE_LIMITED', errorReason: '通义千问请求频次限制' },
          });
          return;
        }

        if (!isContinuation) {
          await qwenAdapter.createNewChat();
        }

        send({
          type: 'STATUS_CHANGE',
          payload: { siteName: 'Qwen', jobId, status: 'SENDING' },
        });

        const sent = await qwenAdapter.sendPrompt(prompt);
        if (!sent) {
          send({
            type: 'STATUS_CHANGE',
            payload: { siteName: 'Qwen', jobId, status: 'FAILED', errorReason: '输入框注入或点击发送失败' },
          });
          return;
        }

        const validated = await qwenAdapter.validateSubmission();
        if (!validated) {
          send({
            type: 'STATUS_CHANGE',
            payload: { siteName: 'Qwen', jobId, status: 'FAILED', errorReason: '提交后会话未响应' },
          });
          return;
        }

        send({
          type: 'STATUS_CHANGE',
          payload: { siteName: 'Qwen', jobId, status: 'STREAMING' },
        });

        if (stopListening) stopListening();

        stopListening = qwenAdapter.listenGeneration(
          (snapshot, cleaned) => {
            send({
              type: 'STREAM_UPDATE',
              payload: {
                siteName: 'Qwen',
                jobId,
                snapshot,
                cleaned,
                isFinished: false,
              },
            });
          },
          (finalCleaned) => {
            const finalUrl = qwenAdapter.getConversationUrl();
            send({
              type: 'STREAM_UPDATE',
              payload: {
                siteName: 'Qwen',
                jobId,
                snapshot: finalCleaned,
                cleaned: finalCleaned,
                isFinished: true,
              },
            });

            send({
              type: 'STATUS_CHANGE',
              payload: {
                siteName: 'Qwen',
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
            siteName: 'Qwen',
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
        sendResponse({ type: 'PONG', siteName: 'Qwen', ready: true });
        return false;
      }
      if (msg.type === 'DISPATCH_PROMPT' || msg.type === 'DISPATCH_SYNTHESIS_PROMPT') {
        sendResponse({ success: true, siteName: 'Qwen', received: true });
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
            siteName: 'Qwen',
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
