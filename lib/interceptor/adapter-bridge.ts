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
  /** DOM 哨兵流式更新回调（当网络层未出字时主动用 DOM 流式推流） */
  handleDomUpdate: (snapshot: string, cleaned: string) => void;
  /** DOM 哨兵完成回调（双轨收敛与智能仲裁） */
  handleDomDone: (finalCleaned: string, conversationUrl?: string) => void;
  /** 查询当前网络层累积快照文本 */
  getAccumulatedSnapshot: () => string;
  /** 查询当前任务是否已终态收敛 */
  isCompleted: () => boolean;
  /** 主动销毁：清空状态机与哨兵状态 */
  destroy: () => void;
}

/**
 * 语义事件 → PortMessage 适配层（双轨伴生收敛增强版）
 *
 * 将 StreamOrchestrator 派发的高层语义事件与 DOM 伴生哨兵（QuadSignalDoneDetector）
 * 统一仲裁，翻译为 Content Script 现有 PortMessage 契约（STREAM_UPDATE / STATUS_CHANGE）。
 * 实现网络高速捕获与 DOM 终极完成判定的双保险互锁。
 */
export function createAdapterBridge(options: AdapterBridgeOptions): AdapterBridgeResult {
  const { siteName, jobId, sendFn, url, prompt = '', onDomFallback, checkDomHasContent } = options;

  // 累计快照（配合 DELTA 增量模式），保证 STREAM_UPDATE 始终带完整文本
  let accumulatedSnapshot = '';
  let fallbackTriggered = false;
  let hasCompleted = false;

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
      if (hasCompleted) return;
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
          if (hasCompleted) return;
          // 关键防空门禁：若网络层虽已 DONE 但提取的正文为空（如 DeepSeek/Wenxin 字段漂移），立即回退 DOM
          if (accumulatedSnapshot.trim().length === 0) {
            triggerFallbackOnce('network stream finished with empty content');
            return;
          }

          hasCompleted = true;
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
          hasCompleted = true;
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

    handleDomUpdate: (snapshot: string, cleaned: string) => {
      if (hasCompleted) return;
      // 若网络层尚未吐出有效字词（如 Gemini/Wenxin 等网络拦截未捕获或前导耗时），用 DOM 推流保证界面响应
      if (accumulatedSnapshot.trim().length === 0 && snapshot.trim().length > 0) {
        sendFn({
          type: 'STREAM_UPDATE',
          payload: {
            siteName,
            jobId,
            snapshot,
            cleaned,
            isFinished: false,
          },
        });
      }
    },

    handleDomDone: (finalCleaned: string, conversationUrl?: string) => {
      if (hasCompleted) return;
      hasCompleted = true;

      // 智能裁决内容：
      // 若网络层内容较为充沛（>30字且不明显小于 DOM 内容），优先采纳网络纯净文本；
      // 否则以 DOM 提取文本兜底收敛。
      let selectedText = accumulatedSnapshot;
      const netLen = accumulatedSnapshot.trim().length;
      const domLen = finalCleaned.trim().length;

      if (netLen < 30 || (domLen > 60 && netLen < domLen * 0.4)) {
        selectedText = finalCleaned;
      }

      const { cleaned } = stripThinkBlocks(selectedText);
      sendFn({
        type: 'STREAM_UPDATE',
        payload: {
          siteName,
          jobId,
          snapshot: selectedText,
          cleaned,
          isFinished: true,
        },
      });
      sendFn({
        type: 'STATUS_CHANGE',
        payload: { siteName, jobId, status: 'DONE', conversationUrl },
      });
      orchestrator.reset();
    },

    getAccumulatedSnapshot: () => accumulatedSnapshot,

    isCompleted: () => hasCompleted,

    destroy: () => {
      hasCompleted = true;
      orchestrator.reset();
      accumulatedSnapshot = '';
      fallbackTriggered = false;
    },
  };
}
