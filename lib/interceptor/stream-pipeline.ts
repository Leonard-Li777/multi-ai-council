import { StreamingUtf8Decoder } from './utf8-decoder';
import type { StreamFramePayload, StreamEndReason, StreamStatus } from '../types/interceptor';

export interface StreamPipelineOptions {
  streamId: string;
  url: string;
  method: 'FETCH' | 'XHR';
  onFrame: (frame: StreamFramePayload) => void;
  onError?: (err: unknown) => void;
}

export interface ExtendedTransformer<I = any, O = any> extends Transformer<I, O> {
  cancel?(reason?: any): void | PromiseLike<void>;
}

/**
 * 构建 TransformStream 原位单管道透传
 * 遵循 Fail-Open 铁律：内部旁路异常绝不阻断或击穿原宿主流 (ctrl.error)
 * 显式实现 cancel 钩子以支持用户主动 Stop
 */
export function createStreamTransformPipeline(options: StreamPipelineOptions): TransformStream<Uint8Array, Uint8Array> {
  const { streamId, url, method, onFrame, onError } = options;
  const decoder = new StreamingUtf8Decoder();
  let sequence = 0;
  let isDone = false;

  const emitFrame = (
    rawText: string,
    status: StreamStatus,
    frameIsDone: boolean,
    endReason?: StreamEndReason
  ) => {
    // 单向不可逆终端态锁：一旦流标记终结，绝不发射任何后续数据或重复终态帧
    if (isDone) {
      return;
    }
    if (frameIsDone) {
      isDone = true;
    }
    sequence++;
    try {
      onFrame({
        streamId,
        sequence,
        url,
        method,
        rawText,
        isDone: frameIsDone,
        status,
        endReason,
        timestamp: Date.now(),
      });
    } catch (err) {
      if (onError) {
        onError(err);
      }
    }
  };

  const transformer: ExtendedTransformer<Uint8Array, Uint8Array> = {
    transform(chunk, controller) {
      // 1. 必须首先原样透传给宿主前端
      controller.enqueue(chunk);

      // 2. 旁路只读解析与分发 (Fail-Open 保护)
      try {
        const text = decoder.decode(chunk);
        if (text) {
          emitFrame(text, 'STREAMING', false);
        }
      } catch (err) {
        // Fail-Open: 仅记录异常，绝不调用 controller.error()
        if (onError) {
          onError(err);
        }
      }
    },

    flush(controller) {
      // 宿主正常 close 触发 EOF
      try {
        const remaining = decoder.flush();
        emitFrame(remaining, 'DONE', true, 'EOF');
      } catch (err) {
        if (onError) {
          onError(err);
        }
      }
    },

    cancel(reason?: any) {
      // 宿主用户点击 Stop 或 reader 取消时触发
      try {
        const remaining = decoder.flush();
        emitFrame(remaining, 'PARTIAL', true, 'PAGE_ABORT');
      } catch (err) {
        if (onError) {
          onError(err);
        }
      }
    },
  };

  return new TransformStream<Uint8Array, Uint8Array>(transformer as Transformer<Uint8Array, Uint8Array>);
}
