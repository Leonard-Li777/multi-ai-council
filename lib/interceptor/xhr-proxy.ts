import type { StreamFramePayload, StreamEndReason, StreamStatus } from '../types/interceptor';

interface XhrContext {
  streamId: string;
  url: string;
  offset: number;
  sequence: number;
  isDone: boolean;
}

export interface XhrProxyOptions {
  onFrame: (frame: StreamFramePayload) => void;
  onError?: (err: unknown) => void;
}

/**
 * XMLHttpRequest 代理处理器
 * 使用 WeakMap 隔离元数据（0 实例污染）
 * 严格门卫：仅在 responseType 为 '' 或 'text' 时切片，防止二进制抛出 InvalidStateError
 * progress + readystatechange(3/4) 双事件双保险，通过 offset 指针进行幂等切片
 */
export class XhrProxyHandler {
  private contexts = new WeakMap<XMLHttpRequest, XhrContext>();
  private onFrame: (frame: StreamFramePayload) => void;
  private onError?: (err: unknown) => void;

  constructor(options: XhrProxyOptions) {
    this.onFrame = options.onFrame;
    this.onError = options.onError;
  }

  private getOrCreateContext(xhr: XMLHttpRequest, url: string): XhrContext {
    let ctx = this.contexts.get(xhr);
    if (!ctx) {
      ctx = {
        streamId: `xhr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        url,
        offset: 0,
        sequence: 0,
        isDone: false,
      };
      this.contexts.set(xhr, ctx);
    }
    return ctx;
  }

  /**
   * 增量切片核心方法 (flushDelta)
   */
  public flushDelta(
    xhr: XMLHttpRequest,
    url: string,
    isDone = false,
    endReason?: StreamEndReason
  ): void {
    try {
      const ctx = this.getOrCreateContext(xhr, url);

      // 单向不可逆终端态锁：一旦流标记终结，绝不发射任何后续数据或重复终态帧
      if (ctx.isDone) {
        return;
      }

      // 门卫 1: 必须为文本响应类型
      const type = xhr.responseType;
      if (type !== '' && type !== 'text') {
        if (isDone) {
          ctx.isDone = true;
        }
        return;
      }

      const text = xhr.responseText || '';

      // 增量切片
      const delta = text.slice(ctx.offset);
      if (delta.length > 0) {
        ctx.offset = text.length;
        ctx.sequence++;
        this.onFrame({
          streamId: ctx.streamId,
          sequence: ctx.sequence,
          url: ctx.url,
          method: 'XHR',
          rawText: delta,
          isDone: false,
          status: 'STREAMING',
          timestamp: Date.now(),
        });
      }

      // 终态处理
      if (isDone && !ctx.isDone) {
        ctx.isDone = true;
        ctx.sequence++;
        const finalStatus: StreamStatus = endReason === 'PAGE_ABORT' ? 'PARTIAL' : 'DONE';
        this.onFrame({
          streamId: ctx.streamId,
          sequence: ctx.sequence,
          url: ctx.url,
          method: 'XHR',
          rawText: '',
          isDone: true,
          status: finalStatus,
          endReason: endReason || 'EOF',
          timestamp: Date.now(),
        });
      }
    } catch (err) {
      if (this.onError) {
        this.onError(err);
      }
    }
  }

  public handleProgress(xhr: XMLHttpRequest, url: string): void {
    this.flushDelta(xhr, url, false);
  }

  public handleReadyStateChange(xhr: XMLHttpRequest, url: string): void {
    if (xhr.readyState === 3) {
      this.flushDelta(xhr, url, false);
    } else if (xhr.readyState === 4) {
      // 若 status 为 0，表明宿主请求被 abort 或遇到网络错误
      const isAborted = xhr.status === 0;
      this.flushDelta(xhr, url, true, isAborted ? 'PAGE_ABORT' : 'EOF');
    }
  }
}
