import { defineContentScript } from 'wxt/utils/define-content-script';
import { wenxinAdapter } from '../lib/adapters/wenxin.adapter';
import { CONTENT_PORT_NAME, setupPortWithHeartbeat, type PortMessage } from '../lib/messaging/port';

export default defineContentScript({
  matches: ['https://wenxin.baidu.com/*'],
  runAt: 'document_idle',
  main() {
    console.log('[Multi-AI Council] Wenxin content script initialized');

    let stopListening: (() => void) | null = null;
    let currentJobId: string | null = null;

    const { send } = setupPortWithHeartbeat(CONTENT_PORT_NAME, async (msg: PortMessage) => {
      if (msg.type === 'DISPATCH_PROMPT' && msg.payload.siteName === 'Wenxin') {
        const { jobId, prompt, isContinuation } = msg.payload;
        currentJobId = jobId;

        const blocker = await wenxinAdapter.checkBlocker();
        if (blocker === 'CAPTCHA') {
          send({
            type: 'STATUS_CHANGE',
            payload: { siteName: 'Wenxin', jobId, status: 'BLOCKED_CAPTCHA', errorReason: '检测到百度验证码，请人工通过' },
          });
          return;
        }
        if (blocker === 'NOT_LOGGED_IN') {
          send({
            type: 'STATUS_CHANGE',
            payload: { siteName: 'Wenxin', jobId, status: 'BLOCKED_LOGIN', errorReason: '检测到百度未登录状态，请先登录' },
          });
          return;
        }
        if (blocker === 'RATE_LIMIT') {
          send({
            type: 'STATUS_CHANGE',
            payload: { siteName: 'Wenxin', jobId, status: 'RATE_LIMITED', errorReason: '文心一言请求限制' },
          });
          return;
        }

        if (!isContinuation) {
          await wenxinAdapter.createNewChat();
        }

        send({
          type: 'STATUS_CHANGE',
          payload: { siteName: 'Wenxin', jobId, status: 'SENDING' },
        });

        const sent = await wenxinAdapter.sendPrompt(prompt);
        if (!sent) {
          send({
            type: 'STATUS_CHANGE',
            payload: { siteName: 'Wenxin', jobId, status: 'FAILED', errorReason: '输入框注入或点击发送失败' },
          });
          return;
        }

        const validated = await wenxinAdapter.validateSubmission();
        if (!validated) {
          send({
            type: 'STATUS_CHANGE',
            payload: { siteName: 'Wenxin', jobId, status: 'FAILED', errorReason: '提交后会话未响应' },
          });
          return;
        }

        send({
          type: 'STATUS_CHANGE',
          payload: { siteName: 'Wenxin', jobId, status: 'STREAMING' },
        });

        if (stopListening) stopListening();

        stopListening = wenxinAdapter.listenGeneration(
          (snapshot, cleaned) => {
            send({
              type: 'STREAM_UPDATE',
              payload: {
                siteName: 'Wenxin',
                jobId,
                snapshot,
                cleaned,
                isFinished: false,
              },
            });
          },
          (finalCleaned) => {
            const finalUrl = wenxinAdapter.getConversationUrl();
            send({
              type: 'STREAM_UPDATE',
              payload: {
                siteName: 'Wenxin',
                jobId,
                snapshot: finalCleaned,
                cleaned: finalCleaned,
                isFinished: true,
              },
            });

            send({
              type: 'STATUS_CHANGE',
              payload: {
                siteName: 'Wenxin',
                jobId,
                status: 'DONE',
                conversationUrl: finalUrl,
              },
            });
          }
        );
      }
    });

    send({
      type: 'CONTENT_READY',
      payload: {
        siteName: 'Wenxin',
        url: window.location.href,
      },
    });

    let lastUrl = window.location.href;
    const urlCheckInterval = window.setInterval(() => {
      if (window.location.href !== lastUrl) {
        lastUrl = window.location.href;
        send({
          type: 'UPDATE_CONVERSATION_URL',
          payload: {
            siteName: 'Wenxin',
            jobId: currentJobId || undefined,
            conversationUrl: lastUrl,
          },
        });
      }
    }, 1000);

    window.addEventListener('beforeunload', () => {
      if (stopListening) stopListening();
      clearInterval(urlCheckInterval);
    });
  },
});
