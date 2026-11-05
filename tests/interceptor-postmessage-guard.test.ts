import { describe, it, expect } from 'vitest';
import {
  StreamFrameValidator,
  MAX_STREAM_FRAME_SIZE,
} from '../lib/interceptor/frame-validator';
import type { StreamFramePayload } from '../lib/types/interceptor';

describe('AC10a: 管道层 postMessage 硬防御与状态单向锁单测 (StreamFrameValidator)', () => {
  it('拒绝未注册 streamId 的直接 isDone: true 虚构握手', () => {
    const validator = new StreamFrameValidator({ allowedOrigin: 'https://chatgpt.com' });

    const forgedFrame: StreamFramePayload = {
      streamId: 'forged-stream-999',
      sequence: 1,
      url: 'https://chatgpt.com/backend-api/conversation',
      method: 'FETCH',
      rawText: '',
      isDone: true,
      status: 'DONE',
      timestamp: Date.now(),
    };

    const result = validator.validateFrame(forgedFrame, 'https://chatgpt.com');
    expect(result.valid).toBe(false);
    expect(result.reason).toContain('未注册');
  });

  it('允许携带有效内容的单帧自完备流直接完成 (isDone: true)', () => {
    const validator = new StreamFrameValidator({ allowedOrigin: 'https://chatgpt.com' });

    const singleShotFrame: StreamFramePayload = {
      streamId: 'single-shot-1',
      sequence: 1,
      url: 'https://chatgpt.com/backend-api/conversation',
      method: 'FETCH',
      rawText: 'Full answer in one shot',
      isDone: true,
      status: 'DONE',
      timestamp: Date.now(),
    };

    const result = validator.validateFrame(singleShotFrame, 'https://chatgpt.com');
    expect(result.valid).toBe(true);

    // 随后到来的帧应被终端态拦截
    const delayedFrame: StreamFramePayload = {
      streamId: 'single-shot-1',
      sequence: 2,
      url: 'https://chatgpt.com/backend-api/conversation',
      method: 'FETCH',
      rawText: 'delayed chunk',
      isDone: false,
      status: 'STREAMING',
      timestamp: Date.now(),
    };
    const delayedResult = validator.validateFrame(delayedFrame, 'https://chatgpt.com');
    expect(delayedResult.valid).toBe(false);
    expect(delayedResult.reason).toContain('已处于终端态');
  });

  it('正常注册的流式帧可顺利通过，并记录递增序号', () => {
    const validator = new StreamFrameValidator({ allowedOrigin: 'https://chatgpt.com' });

    const frame1: StreamFramePayload = {
      streamId: 'stream-123',
      sequence: 1,
      url: 'https://chatgpt.com/backend-api/conversation',
      method: 'FETCH',
      rawText: 'hello',
      isDone: false,
      status: 'STREAMING',
      timestamp: Date.now(),
    };

    const r1 = validator.validateFrame(frame1, 'https://chatgpt.com');
    expect(r1.valid).toBe(true);

    const frame2: StreamFramePayload = {
      streamId: 'stream-123',
      sequence: 2,
      url: 'https://chatgpt.com/backend-api/conversation',
      method: 'FETCH',
      rawText: ' world',
      isDone: false,
      status: 'STREAMING',
      timestamp: Date.now(),
    };
    const r2 = validator.validateFrame(frame2, 'https://chatgpt.com');
    expect(r2.valid).toBe(true);
  });

  it('针对已处于终端态（DONE / PARTIAL / ERROR）的 streamId，后续帧 100% 丢弃', () => {
    const validator = new StreamFrameValidator({ allowedOrigin: 'https://chatgpt.com' });

    // 1. 正常流
    validator.validateFrame(
      {
        streamId: 'stream-term',
        sequence: 1,
        url: 'https://chatgpt.com/backend-api/conversation',
        method: 'FETCH',
        rawText: 'initial',
        isDone: false,
        status: 'STREAMING',
        timestamp: Date.now(),
      },
      'https://chatgpt.com'
    );

    // 2. 终结流 (PARTIAL)
    validator.validateFrame(
      {
        streamId: 'stream-term',
        sequence: 2,
        url: 'https://chatgpt.com/backend-api/conversation',
        method: 'FETCH',
        rawText: '',
        isDone: true,
        status: 'PARTIAL',
        endReason: 'PAGE_ABORT',
        timestamp: Date.now(),
      },
      'https://chatgpt.com'
    );

    // 3. 延迟到达的僵尸帧，必须 100% 拒绝
    const zombieFrame: StreamFramePayload = {
      streamId: 'stream-term',
      sequence: 3,
      url: 'https://chatgpt.com/backend-api/conversation',
      method: 'FETCH',
      rawText: 'delayed zombie text',
      isDone: false,
      status: 'STREAMING',
      timestamp: Date.now(),
    };

    const rZombie = validator.validateFrame(zombieFrame, 'https://chatgpt.com');
    expect(rZombie.valid).toBe(false);
    expect(rZombie.reason).toContain('已处于终端态');
  });

  it('超过 MAX_STREAM_FRAME_SIZE 的异常/攻击帧直接拦截丢弃', () => {
    const validator = new StreamFrameValidator({ allowedOrigin: 'https://chatgpt.com' });

    const hugeText = 'x'.repeat(MAX_STREAM_FRAME_SIZE + 1024);
    const hugeFrame: StreamFramePayload = {
      streamId: 'stream-huge',
      sequence: 1,
      url: 'https://chatgpt.com/backend-api/conversation',
      method: 'FETCH',
      rawText: hugeText,
      isDone: false,
      status: 'STREAMING',
      timestamp: Date.now(),
    };

    const rHuge = validator.validateFrame(hugeFrame, 'https://chatgpt.com');
    expect(rHuge.valid).toBe(false);
    expect(rHuge.reason).toContain('超限');
  });

  it('sequence 非单调递增帧直接拦截丢弃', () => {
    const validator = new StreamFrameValidator({ allowedOrigin: 'https://chatgpt.com' });

    validator.validateFrame(
      {
        streamId: 'stream-seq',
        sequence: 1,
        url: 'https://chatgpt.com/backend-api/conversation',
        method: 'FETCH',
        rawText: 'frame 1',
        isDone: false,
        status: 'STREAMING',
        timestamp: Date.now(),
      },
      'https://chatgpt.com'
    );

    // 倒退的序号或重复的序号
    const outOfOrderFrame: StreamFramePayload = {
      streamId: 'stream-seq',
      sequence: 1,
      url: 'https://chatgpt.com/backend-api/conversation',
      method: 'FETCH',
      rawText: 'frame duplicate',
      isDone: false,
      status: 'STREAMING',
      timestamp: Date.now(),
    };

    const rSeq = validator.validateFrame(outOfOrderFrame, 'https://chatgpt.com');
    expect(rSeq.valid).toBe(false);
    expect(rSeq.reason).toContain('单调递增');
  });

  it('非法跨源来源（Origin 不匹配）直接拦截丢弃', () => {
    const validator = new StreamFrameValidator({ allowedOrigin: 'https://chatgpt.com' });

    const evilFrame: StreamFramePayload = {
      streamId: 'stream-evil',
      sequence: 1,
      url: 'https://chatgpt.com/backend-api/conversation',
      method: 'FETCH',
      rawText: 'evil text',
      isDone: false,
      status: 'STREAMING',
      timestamp: Date.now(),
    };

    const rEvil = validator.validateFrame(evilFrame, 'https://attacker.evil.com');
    expect(rEvil.valid).toBe(false);
    expect(rEvil.reason).toContain('源不匹配');
  });
});
