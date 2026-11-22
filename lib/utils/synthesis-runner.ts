import type { AISiteAdapter } from '../adapters/base';
import type { PortMessage } from '../messaging/port';
import type { SynthesisStep } from './synthesis-builder';

export interface SynthesisRunnerController {
  handleDispatchSynthesis: (payload: {
    jobId: string;
    metaPrompt: string;
    steps?: SynthesisStep[];
  }) => Promise<void>;
  cancel: () => void;
}

/**
 * 通用分轮终审执行器（适用于所有 6 个支持站点：DeepSeek / ChatGPT / Claude / Gemini / Qwen / Wenxin）
 * 在当前会话中按「引导提示词 -> 逐个其他站点回复 -> 提交完成」严格串行执行，
 * 每轮等待前序回复结束，最终轮次流式回传剥离思维链后的综合终审报告。
 */
export function createSequentialSynthesisRunner(
  adapter: AISiteAdapter,
  send: (msg: PortMessage) => void
): SynthesisRunnerController {
  let isSynthesizing = false;
  let activeJobId: string | null = null;
  let activeToken = 0;
  let stopListening: (() => void) | null = null;

  const cleanupListener = () => {
    if (stopListening) {
      stopListening();
      stopListening = null;
    }
  };

  const cancel = () => {
    activeToken++;
    isSynthesizing = false;
    cleanupListener();
  };

  const handleDispatchSynthesis = async (payload: {
    jobId: string;
    metaPrompt: string;
    steps?: SynthesisStep[];
  }): Promise<void> => {
    const { jobId, metaPrompt, steps } = payload;
    if (isSynthesizing && activeJobId === jobId) {
      console.log(`[SynthesisRunner:${adapter.siteName}] Ignoring duplicate SYNTHESIS dispatch for Job ${jobId}`);
      return;
    }

    activeJobId = jobId;
    isSynthesizing = true;
    activeToken++;
    const myToken = activeToken;

    const synthesisQueue: SynthesisStep[] =
      steps && steps.length > 0
        ? steps
        : [{ id: 'single', label: '发送终审提示词', prompt: metaPrompt, isFinal: true }];

    console.log(
      `[SynthesisRunner:${adapter.siteName}] Starting sequential synthesis for Job ${jobId} (${synthesisQueue.length} turns)`
    );

    const waitUntilIdle = async (maxWaitMs = 60000) => {
      const deadline = Date.now() + maxWaitMs;
      while (adapter.findStopButton?.() && Date.now() < deadline) {
        if (myToken !== activeToken) return;
        await new Promise((r) => setTimeout(r, 500));
      }
    };

    const waitForIntermediateTurnDone = (timeoutMs = 150000): Promise<void> => {
      return new Promise((resolve) => {
        cleanupListener();
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          cleanupListener();
          resolve();
        };

        const timer = window.setTimeout(() => {
          console.warn(
            `[SynthesisRunner:${adapter.siteName}] Intermediate synthesis turn timed out, continuing to next turn`
          );
          finish();
        }, timeoutMs);

        stopListening = adapter.listenGeneration(
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
      const blocker = await adapter.checkBlocker();
      if (blocker === 'CAPTCHA') {
        isSynthesizing = false;
        send({
          type: 'SYNTHESIS_STATUS_CHANGE',
          payload: { jobId, status: 'BLOCKED_CAPTCHA', errorReason: `${adapter.siteName} 终审检测到人机验证，请人工通过` },
        });
        return;
      }
      if (blocker === 'NOT_LOGGED_IN') {
        isSynthesizing = false;
        send({
          type: 'SYNTHESIS_STATUS_CHANGE',
          payload: { jobId, status: 'BLOCKED_LOGIN', errorReason: `${adapter.siteName} 终审检测到未登录状态，请先登录` },
        });
        return;
      }
      if (blocker === 'RATE_LIMIT') {
        isSynthesizing = false;
        send({
          type: 'SYNTHESIS_STATUS_CHANGE',
          payload: { jobId, status: 'RATE_LIMITED', errorReason: `${adapter.siteName} 触发流量限制，可在设置中切换其他站点作为终审` },
        });
        return;
      }

      // 2. 分轮依次提交：引导提示词 -> 逐个站点回复 -> “提交完成”
      for (let i = 0; i < synthesisQueue.length; i++) {
        if (myToken !== activeToken) {
          isSynthesizing = false;
          return;
        }
        const step = synthesisQueue[i]!;

        await waitUntilIdle();
        if (myToken !== activeToken) {
          isSynthesizing = false;
          return;
        }

        send({
          type: 'SYNTHESIS_STATUS_CHANGE',
          payload: { jobId, status: 'SENDING' },
        });

        send({
          type: 'SYNTHESIS_STREAM_UPDATE',
          payload: {
            jobId,
            snapshot: step.isFinal
              ? `⏳ [${adapter.siteName}] 分轮送审进度 (${i + 1}/${synthesisQueue.length})：${step.label}...`
              : `⏳ [${adapter.siteName}] 分轮送审进度 (${i + 1}/${synthesisQueue.length})：${step.label}...\n\n正在发送并等待 ${adapter.siteName} 接收完毕，完成后将自动继续下一轮。`,
            isFinished: false,
          },
        });

        const sent = await adapter.sendPrompt(step.prompt);
        if (!sent) {
          isSynthesizing = false;
          send({
            type: 'SYNTHESIS_STATUS_CHANGE',
            payload: {
              jobId,
              status: 'FAILED',
              errorReason: `${adapter.siteName} 终审第 ${i + 1} 轮（${step.label}）注入或点击发送失败`,
            },
          });
          return;
        }

        const validated = await adapter.validateSubmission();
        if (!validated) {
          isSynthesizing = false;
          send({
            type: 'SYNTHESIS_STATUS_CHANGE',
            payload: {
              jobId,
              status: 'FAILED',
              errorReason: `${adapter.siteName} 终审第 ${i + 1} 轮（${step.label}）提交后页面无响应`,
            },
          });
          return;
        }

        if (!step.isFinal) {
          await waitForIntermediateTurnDone();
          await new Promise((r) => setTimeout(r, 1200));
        } else {
          send({
            type: 'SYNTHESIS_STATUS_CHANGE',
            payload: { jobId, status: 'STREAMING' },
          });

          cleanupListener();
          stopListening = adapter.listenGeneration(
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
      console.error(`[SynthesisRunner:${adapter.siteName}] Synthesis dispatch error:`, err);
      send({
        type: 'SYNTHESIS_STATUS_CHANGE',
        payload: {
          jobId,
          status: 'FAILED',
          errorReason: err instanceof Error ? err.message : String(err),
        },
      });
    }
  };

  return {
    handleDispatchSynthesis,
    cancel,
  };
}
