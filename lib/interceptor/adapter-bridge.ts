import { StreamOrchestrator } from './stream-orchestrator';
import { stripThinkBlocks } from '../utils/think-block-strip';
import type { SupportedSite } from '../types/review-job';
import type { PortMessage } from '../messaging/port';

export interface AdapterBridgeOptions {
  siteName: SupportedSite;
  jobId: string;
  /** 发送 PortMessage 给 Background/Side Panel 的函数 */
  sendFn: (msg: PortMessage) => void;
  /** 当前站点的 AI API URL，用于语义解析器路由判定 */
  url: string;
  /** 用户 Prompt（可选，供 Gemini 解包器排除回显） */
  prompt?: string;
  /** 网络流未命中、15s 超时或异常时触发的 DOM 兜底回调 */
  onDomFallback?: () => void;
  /** 检查当前 DOM 是否已有回答内容的判断函数 (可选) */
  checkDomHasContent?: () => boolean;
}

export interface AdapterBridgeResult {
  /** 状态机实例，供 Content Script 检查 getState() 决定是否启动 DOM fallback */
  orchestrator: StreamOrchestrator;
  /** 主动销毁：清空状态机 */
  destroy: () => void;
}

/**
 * 语义事件 → PortMessage 适配层
 *
 * 将 StreamOrchestrator 派发的高层语义事件（SNAPSHOT / DELTA / DONE / PARTIAL / ERROR）
 * 翻译为 Content Script 现有 PortMessage 契约（STREAM_UPDATE / STATUS_CHANGE），
 * 实现网络层与 Background/Side Panel 通信层的解耦。
 */
export function createAdapterBridge(options: AdapterBridgeOptions): AdapterBridgeResult {
  const { siteName, jobId, sendFn, url, prompt = '', onDomFallback, checkDomHasContent } = options;

  // 累计快照（配合 DELTA 增量模式），保证 STREAM_UPDATE 始终带完整文本
  let accumulatedSnapshot = '';
  let fallbackTriggered = false;

  const triggerFallbackOnce = (reason: string) => {
    if (fallbackTriggered) return;
    fallbackTriggered = true;
    console.warn(`[AdapterBridge:${siteName}] Triggering DOM fallback, reason: ${reason}`);
    onDomFallback?.();
  };

  const orchestrator = new StreamOrchestrator({
    onResumeDom: () => {
      triggerFallbackOnce('onResumeDom called from orchestrator');
    },
    checkDomHasContent,

    onSnapshotUpdate: (text: string) => {
      accumulatedSnapshot = text;
      const { cleaned } = stripThinkBlocks(text);
      sendFn({
        type: 'STREAM_UPDATE',
        payload: {
          siteName,
          jobId,
          snapshot: text,
          cleaned,
          isFinished: false,
        },
      });
    },

    onStateChange: (state) => {
      switch (state) {
        case 'DOM_FALLBACK': {
          triggerFallbackOnce('state transitioned to DOM_FALLBACK');
          break;
        }

        case 'DONE': {
          // 关键防空门禁：若网络层虽已 DONE 但提取的正文为空（如 DeepSeek/Wenxin 字段漂移），立即回退 DOM
          if (accumulatedSnapshot.trim().length === 0) {
            triggerFallbackOnce('network stream finished with empty content');
            return;
          }

          const { cleaned } = stripThinkBlocks(accumulatedSnapshot);
          sendFn({
            type: 'STREAM_UPDATE',
            payload: {
              siteName,
              jobId,
              snapshot: accumulatedSnapshot,
              cleaned,
              isFinished: true,
            },
          });
          sendFn({
            type: 'STATUS_CHANGE',
            payload: { siteName, jobId, status: 'DONE' },
          });
          break;
        }

        case 'PARTIAL': {
          sendFn({
            type: 'STATUS_CHANGE',
            payload: { siteName, jobId, status: 'PARTIAL' },
          });
          break;
        }

        case 'ERROR': {
          // 发生错误时优先尝试 DOM 兜底，绝不提前让任务死锁
          triggerFallbackOnce('network error occurred');
          break;
        }

        default:
          break;
      }
    },
  });

  return {
    orchestrator,
    destroy: () => {
      orchestrator.reset();
      accumulatedSnapshot = '';
      fallbackTriggered = false;
    },
  };
}
