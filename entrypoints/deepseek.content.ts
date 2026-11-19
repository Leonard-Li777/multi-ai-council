import { defineContentScript } from 'wxt/utils/define-content-script';
import { deepSeekAdapter } from '../lib/adapters/deepseek.adapter';
import { CONTENT_PORT_NAME, setupPortWithHeartbeat, type PortMessage } from '../lib/messaging/port';
import { NetworkListener } from '../lib/interceptor/network-listener';
import { createAdapterBridge } from '../lib/interceptor/adapter-bridge';

export default defineContentScript({
  matches: ['https://chat.deepseek.com/*'],
  runAt: 'document_idle',
  main() {
    console.log('[Multi-AI Council] DeepSeek content script initialized');

    let stopListening: (() => void) | null = null;
    let currentJobId: string | null = null;
    let isDispatching = false;
    let isSynthesizing = false;
    let activeSynthesisToken = 0;
    let lastHandledJobId = '';
    let sendFn: ((msg: PortMessage) => void) | null = null;
    const send = (msg: PortMessage) => {
      if (sendFn) sendFn(msg);
    };

    // --- 网络层拦截集成 (双轨融合) ---
    let networkListener: NetworkListener | null = null;
    let networkBridgeDestroy: (() => void) | null = null;

    const handleIncomingMessage = async (msg: PortMessage) => {
      if (msg.type === 'DISPATCH_PROMPT' && msg.payload.siteName === 'DeepSeek') {
        const { jobId, prompt, isContinuation } = msg.payload;
        if (isDispatching) {
          console.log(`[DeepSeekContent] Preempting previous dispatch for Job ${jobId}`);
          if (stopListening) {
            stopListening();
            stopListening = null;
          }
          networkListener?.destroy();
          networkBridgeDestroy?.();
        }
        isDispatching = true;
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

          // 6. 标记为 STREAMING 并启动双轨监听（网络层优先，DOM 降级兜底）
          send({
            type: 'STATUS_CHANGE',
            payload: { siteName: 'DeepSeek', jobId, status: 'STREAMING' },
          });

          if (stopListening) {
            stopListening();
            stopListening = null;
          }
          networkListener?.destroy();
          networkBridgeDestroy?.();

          // 创建 AdapterBridge：StreamOrchestrator 语义事件 + DOM 伴生哨兵 → PortMessage
          const bridge = createAdapterBridge({
            siteName: 'DeepSeek',
            jobId,
            sendFn: send,
            url: 'https://chat.deepseek.com/api/v0/chat/completion',
            prompt,
          });
          networkBridgeDestroy = bridge.destroy;

          // 核心机制：立即挂载 DOM 伴生哨兵（实时流式互补 + 终极 2.5s 静默判定收敛）
          stopListening = deepSeekAdapter.listenGeneration(
            (snapshot, cleaned) => {
              bridge.handleDomUpdate(snapshot, cleaned);
            },
            (finalCleaned) => {
              const finalUrl = deepSeekAdapter.getConversationUrl();
              bridge.handleDomDone(finalCleaned, finalUrl);
            }
          );

          bridge.orchestrator.dispatchPrompt(jobId, prompt);

          networkListener = new NetworkListener({
            allowedOrigin: 'https://chat.deepseek.com',
            onValidFrame: (frame) => {
              bridge.orchestrator.handleStreamFrame(frame);
            },
            onInvalidFrame: (frame, reason) => {
              console.warn(`[DeepSeekContent] Invalid frame rejected: ${reason}`, frame.streamId);
            },
          });
          networkListener.start();
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
        } finally {
          isDispatching = false;
        }
      } else if (msg.type === 'RECOVER_SITE' && msg.payload.siteName === 'DeepSeek') {
        const { jobId, prompt } = msg.payload;
        currentJobId = jobId;
        console.log(`[DeepSeekContent] Executing auto-recovery for Job ${jobId}`);

        try {
          if (stopListening) stopListening();

          const result = await deepSeekAdapter.autoRecoverAndContinue(
            prompt,
            (snapshot, cleaned) => {
              send({
                type: 'STREAM_UPDATE',
                payload: { siteName: 'DeepSeek', jobId, snapshot, cleaned, isFinished: false },
              });
            },
            (finalCleaned) => {
              const finalUrl = deepSeekAdapter.getConversationUrl();
              send({
                type: 'STREAM_UPDATE',
                payload: { siteName: 'DeepSeek', jobId, snapshot: finalCleaned, cleaned: finalCleaned, isFinished: true },
              });
              send({
                type: 'STATUS_CHANGE',
                payload: { siteName: 'DeepSeek', jobId, status: 'DONE', conversationUrl: finalUrl },
              });
            }
          );

          if (result === 'STREAMING') {
            send({ type: 'STATUS_CHANGE', payload: { siteName: 'DeepSeek', jobId, status: 'STREAMING' } });
          } else if (result === 'FAILED') {
            send({
              type: 'STATUS_CHANGE',
              payload: { siteName: 'DeepSeek', jobId, status: 'FAILED', errorReason: '自愈重试未成功，请检查页面输入框状态' },
            });
          }
        } catch (err) {
          console.error('[DeepSeekContent] Recovery error:', err);
          send({
            type: 'STATUS_CHANGE',
            payload: { siteName: 'DeepSeek', jobId, status: 'FAILED', errorReason: String(err) },
          });
        }
      } else if (msg.type === 'DISPATCH_SYNTHESIS_PROMPT') {
        const { jobId, metaPrompt, steps } = msg.payload;
        if (isSynthesizing && currentJobId === jobId) {
          console.log(`[DeepSeekContent] Ignoring duplicate SYNTHESIS dispatch for Job ${jobId}`);
          return;
        }
        currentJobId = jobId;
        isSynthesizing = true;
        activeSynthesisToken++;
        const myToken = activeSynthesisToken;

        const synthesisQueue =
          steps && steps.length > 0
            ? steps
            : [{ id: 'single', label: '发送终审提示词', prompt: metaPrompt, isFinal: true }];

        console.log(
          `[DeepSeekContent] Received SYNTHESIS prompt for Job ${jobId}, sequential turns: ${synthesisQueue.length}`
        );

        const waitUntilIdle = async (maxWaitMs = 60000) => {
          const deadline = Date.now() + maxWaitMs;
          while (deepSeekAdapter.findStopButton() && Date.now() < deadline) {
            if (myToken !== activeSynthesisToken) return;
            await new Promise((r) => setTimeout(r, 500));
          }
        };

        const waitForIntermediateTurnDone = (timeoutMs = 150000): Promise<void> => {
          return new Promise((resolve) => {
            if (stopListening) {
              stopListening();
              stopListening = null;
            }
            let settled = false;
            const finish = () => {
              if (settled) return;
              settled = true;
              window.clearTimeout(timer);
              if (stopListening) {
                stopListening();
                stopListening = null;
              }
              resolve();
            };

            const timer = window.setTimeout(() => {
              console.warn('[DeepSeekContent] Intermediate synthesis turn timed out, continuing to next turn');
              finish();
            }, timeoutMs);

            stopListening = deepSeekAdapter.listenGeneration(
              () => {},
              () => {
                finish();
              },
              { allowShortReply: true, silenceThresholdMs: 2500 }
            );
          });
        };

        try {
          // 1. 检查页面阻断状态
          const blocker = await deepSeekAdapter.checkBlocker();
          if (blocker === 'CAPTCHA') {
            isSynthesizing = false;
            send({
              type: 'SYNTHESIS_STATUS_CHANGE',
              payload: { jobId, status: 'BLOCKED_CAPTCHA', errorReason: '终审检测到人机验证，请人工通过' },
            });
            return;
          }
          if (blocker === 'NOT_LOGGED_IN') {
            isSynthesizing = false;
            send({
              type: 'SYNTHESIS_STATUS_CHANGE',
              payload: { jobId, status: 'BLOCKED_LOGIN', errorReason: '终审检测到未登录状态，请先登录 DeepSeek' },
            });
            return;
          }

          // 2. 分轮依次提交：引导提示词 -> 逐个站点回复 -> “提交完成”
          for (let i = 0; i < synthesisQueue.length; i++) {
            if (myToken !== activeSynthesisToken) {
              isSynthesizing = false;
              return;
            }
            const step = synthesisQueue[i]!;

            // 等待前序回答生成完毕（若停止生成按钮存在，等待其结束）
            await waitUntilIdle();
            if (myToken !== activeSynthesisToken) {
              isSynthesizing = false;
              return;
            }

            if (!step.isFinal) {
              send({
                type: 'SYNTHESIS_STATUS_CHANGE',
                payload: { jobId, status: 'SENDING' },
              });
              send({
                type: 'SYNTHESIS_STREAM_UPDATE',
                payload: {
                  jobId,
                  snapshot: `⏳ 分轮送审进度 (${i + 1}/${synthesisQueue.length})：${step.label}...\n\n正在发送并等待 DeepSeek 接收完毕，完成后将自动继续下一轮。`,
                  isFinished: false,
                },
              });
            } else {
              send({
                type: 'SYNTHESIS_STATUS_CHANGE',
                payload: { jobId, status: 'SENDING' },
              });
              send({
                type: 'SYNTHESIS_STREAM_UPDATE',
                payload: {
                  jobId,
                  snapshot: `⏳ 分轮送审进度 (${i + 1}/${synthesisQueue.length})：${step.label}...`,
                  isFinished: false,
                },
              });
            }

            // 模拟写入并提交（在 DeepSeek 当前会话中多轮依次追加发送）
            const sent = await deepSeekAdapter.sendPrompt(step.prompt);
            if (!sent) {
              isSynthesizing = false;
              send({
                type: 'SYNTHESIS_STATUS_CHANGE',
                payload: { jobId, status: 'FAILED', errorReason: `终审第 ${i + 1} 轮（${step.label}）注入或点击发送失败` },
              });
              return;
            }

            // 校验提交状态
            const validated = await deepSeekAdapter.validateSubmission();
            if (!validated) {
              isSynthesizing = false;
              send({
                type: 'SYNTHESIS_STATUS_CHANGE',
                payload: { jobId, status: 'FAILED', errorReason: `终审第 ${i + 1} 轮（${step.label}）提交后页面无响应` },
              });
              return;
            }

            if (!step.isFinal) {
              // 中间轮次：严格等待 DeepSeek 回复完毕后再提交下一轮
              await waitForIntermediateTurnDone();
              // 留出 1200ms 缓冲等待输入框与发送按钮稳定
              await new Promise((r) => setTimeout(r, 1200));
            } else {
              // 最终轮次（“提交完成”）：切换为 STREAMING 并流式回传剥离思维链后的最终综合报告
              send({
                type: 'SYNTHESIS_STATUS_CHANGE',
                payload: { jobId, status: 'STREAMING' },
              });

              if (stopListening) {
                stopListening();
                stopListening = null;
              }

              stopListening = deepSeekAdapter.listenGeneration(
                (_rawSnapshot, cleaned) => {
                  if (!cleaned) return;
                  send({
                    type: 'SYNTHESIS_STREAM_UPDATE',
                    payload: {
                      jobId,
                      snapshot: cleaned,
                      isFinished: false,
                    },
                  });
                },
                (finalCleaned) => {
                  isSynthesizing = false;
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
          }
        } catch (err) {
          isSynthesizing = false;
          console.error('[DeepSeekContent] Synthesis dispatch error:', err);
          send({
            type: 'SYNTHESIS_STATUS_CHANGE',
            payload: {
              jobId,
              status: 'FAILED',
              errorReason: err instanceof Error ? err.message : String(err),
            },
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
      if (msg.type === 'DISPATCH_PROMPT' || msg.type === 'DISPATCH_SYNTHESIS_PROMPT' || msg.type === 'RECOVER_SITE') {
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
      networkListener?.destroy();
      networkBridgeDestroy?.();
      clearInterval(urlCheckInterval);
      if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
        chrome.runtime.onMessage.removeListener(runtimeMessageListener);
      }
    });
  },
});
