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
 *
 * 用法：
 *   const { orchestrator } = createAdapterBridge({ siteName, jobId, sendFn, url });
 *   orchestrator.dispatchPrompt(jobId, prompt);
 *   // 然后把收到的 StreamFramePayload 喂给 orchestrator.handleStreamFrame(frame)
 */
export function createAdapterBridge(options: AdapterBridgeOptions): AdapterBridgeResult {
  const { siteName, jobId, sendFn, url, prompt = '' } = options;

  // 累计快照（配合 DELTA 增量模式），保证 STREAM_UPDATE 始终带完整文本
  let accumulatedSnapshot = '';

  const orchestrator = new StreamOrchestrator({
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
        case 'DONE': {
          const { cleaned } = stripThinkBlocks(accumulatedSnapshot);
          // 先发 isFinished: true 的 STREAM_UPDATE，再发状态变更
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
          sendFn({
            type: 'STATUS_CHANGE',
            payload: {
              siteName,
              jobId,
              status: 'FAILED',
              errorReason: '网络层解析异常（StreamOrchestrator ERROR 态）',
            },
          });
          break;
        }

        // IDLE / PENDING_STREAM / STREAMING / DOM_FALLBACK 无需发消息
        default:
          break;
      }
    },
  });

  // 重置快照（以防复用）
  accumulatedSnapshot = '';

  return {
    orchestrator,
    destroy: () => {
      orchestrator.reset();
      accumulatedSnapshot = '';
    },
  };
}
