/**
 * 跨世界 IPC 流式通信契约与状态定义
 * 符合 API Stream Interception Spec v2.2 规范
 */

export type StreamStatus = 'STREAMING' | 'DONE' | 'PARTIAL' | 'ERROR';

export type StreamEndReason = 'EOF' | 'PAGE_ABORT' | 'OBSERVER_ABORT' | 'PARSER_ERROR';

export interface StreamFramePayload {
  streamId: string;
  sequence: number;
  url: string;
  method: 'FETCH' | 'XHR';
  rawText: string;
  isDone: boolean;
  status: StreamStatus;
  endReason?: StreamEndReason;
  timestamp: number;
}

export type InterceptorMessage = {
  type: '__MULTI_AI_STREAM_FRAME__';
  payload: StreamFramePayload;
};

/**
 * 跨世界 postMessage 单帧体积上限 (默认 4MB 保守设定，Ticket 03 实测后校准为峰值 × 2)
 */
export const MAX_STREAM_FRAME_SIZE = 4 * 1024 * 1024;
