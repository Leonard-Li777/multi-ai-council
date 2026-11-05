import { StreamFrameValidator } from './frame-validator';
import type { StreamFramePayload, InterceptorMessage } from '../types/interceptor';

export interface NetworkListenerOptions {
  /** 允许的 postMessage 来源（例如 'https://chatgpt.com'） */
  allowedOrigin: string;
  /** 经校验通过的帧回调 */
  onValidFrame: (frame: StreamFramePayload) => void;
  /** 被门禁拒绝的帧回调（可选，用于调试） */
  onInvalidFrame?: (frame: StreamFramePayload, reason: string) => void;
}

/**
 * ISOLATED World postMessage 接收器
 *
 * 监听来自 MAIN World BatchedFrameDispatcher 发出的 __MULTI_AI_STREAM_FRAME__ 消息，
 * 经 StreamFrameValidator AC10a 四重门禁校验后，将合法帧派发给 onValidFrame 回调。
 *
 * 生命周期：start() 开始监听，destroy() 移除监听器（防内存泄漏）。
 */
export class NetworkListener {
  private validator: StreamFrameValidator;
  private options: NetworkListenerOptions;
  private messageHandler: ((event: MessageEvent) => void) | null = null;
  private active = false;

  constructor(options: NetworkListenerOptions) {
    this.options = options;
    this.validator = new StreamFrameValidator({ allowedOrigin: options.allowedOrigin });
  }

  public start(): void {
    if (this.active) return; // 幂等保护

    this.messageHandler = (event: MessageEvent) => {
      this.handleMessage(event);
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('message', this.messageHandler);
    }
    this.active = true;
  }

  public destroy(): void {
    if (!this.active) return;
    if (this.messageHandler && typeof window !== 'undefined') {
      window.removeEventListener('message', this.messageHandler);
    }
    this.messageHandler = null;
    this.active = false;
  }

  private handleMessage(event: MessageEvent): void {
    // 1. 类型快速过滤（非目标消息直接跳过，0 开销）
    const data = event.data as InterceptorMessage | undefined;
    if (!data || data.type !== '__MULTI_AI_STREAM_FRAME__') return;

    const frame = data.payload;
    if (!frame || typeof frame !== 'object') return;

    // 2. 经 StreamFrameValidator 四重门禁校验
    const origin = event.origin || '';
    const result = this.validator.validateFrame(frame, origin);

    if (!result.valid) {
      // 门禁拒绝：通知调用方（可选），绝不路由给 onValidFrame
      this.options.onInvalidFrame?.(frame, result.reason ?? 'unknown');
      return;
    }

    // 3. 校验通过，派发给上层处理
    this.options.onValidFrame(frame);
  }
}
