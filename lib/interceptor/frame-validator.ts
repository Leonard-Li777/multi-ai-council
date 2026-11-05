import {
  MAX_STREAM_FRAME_SIZE,
  type StreamFramePayload,
} from '../types/interceptor';

export { MAX_STREAM_FRAME_SIZE };

export interface ValidatorOptions {
  allowedOrigin: string;
}

export interface ValidationResult {
  valid: boolean;
  reason?: string;
}

interface StreamValidationState {
  lastSequence: number;
  isTerminal: boolean;
}

/**
 * 管道层 postMessage 帧校验器 (ISOLATED World 侧前置门禁)
 * 对应 AC10a 验收标准：
 * 1. 拒绝非法跨源来源（Origin 校验）；
 * 2. 拒绝未注册 streamId 的直接 isDone: true 虚构握手；
 * 3. 针对已处于终端态（DONE / PARTIAL / ERROR）的 streamId，后续帧 100% 丢弃；
 * 4. 超过 MAX_STREAM_FRAME_SIZE 的帧直接拦截丢弃；
 * 5. sequence 必须严格单调递增，乱序或倒退帧直接丢弃。
 */
export class StreamFrameValidator {
  private allowedOrigin: string;
  private streamStates = new Map<string, StreamValidationState>();
  private readonly MAX_TRACKED_STREAMS = 200;

  constructor(options: ValidatorOptions) {
    this.allowedOrigin = options.allowedOrigin;
  }

  public validateFrame(frame: StreamFramePayload, origin: string): ValidationResult {
    // 1. Origin 校验
    if (this.allowedOrigin !== '*' && origin !== this.allowedOrigin) {
      return { valid: false, reason: `源不匹配: expected ${this.allowedOrigin}, got ${origin}` };
    }

    // 2. 报文尺寸上限校验
    const rawLen = frame.rawText ? frame.rawText.length : 0;
    if (rawLen > MAX_STREAM_FRAME_SIZE) {
      return { valid: false, reason: `帧报文体积超限: ${rawLen} > ${MAX_STREAM_FRAME_SIZE}` };
    }

    const { streamId, sequence, isDone, status } = frame;
    const existing = this.streamStates.get(streamId);

    // 3. 拒绝未注册 streamId 的直接空内容 isDone 虚构握手 (允许携带有效内容的单帧自完备流)
    if (!existing) {
      if (isDone && (!frame.rawText || frame.rawText.length === 0)) {
        return { valid: false, reason: `拒绝未注册 streamId 的直接 isDone 虚构握手: ${streamId}` };
      }

      // LRU 淘汰旧流，防止无界内存增长
      if (this.streamStates.size >= this.MAX_TRACKED_STREAMS) {
        const firstKey = this.streamStates.keys().next().value;
        if (firstKey) {
          this.streamStates.delete(firstKey);
        }
      }

      // 注册新流
      this.streamStates.set(streamId, {
        lastSequence: sequence,
        isTerminal: Boolean(isDone || status === 'DONE' || status === 'PARTIAL' || status === 'ERROR'),
      });
      return { valid: true };
    }

    // 4. 终端态硬锁：已处于终端态的 streamId，丢弃后续所有帧
    if (existing.isTerminal) {
      return { valid: false, reason: `流已处于终端态，丢弃后续帧: ${streamId}` };
    }

    // 5. sequence 严格单调递增
    if (sequence <= existing.lastSequence) {
      return { valid: false, reason: `sequence 非严格单调递增: current ${sequence} <= last ${existing.lastSequence}` };
    }

    // 更新状态
    existing.lastSequence = sequence;
    if (isDone || status === 'DONE' || status === 'PARTIAL' || status === 'ERROR') {
      existing.isTerminal = true;
    }

    return { valid: true };
  }

  public reset(): void {
    this.streamStates.clear();
  }
}
