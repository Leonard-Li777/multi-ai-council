// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { NetworkListener } from '../lib/interceptor/network-listener';
import type { InterceptorMessage, StreamFramePayload } from '../lib/types/interceptor';

/**
 * AC-NL1: NetworkListener postMessage 路由与门禁校验
 */
describe('AC-NL1: NetworkListener postMessage 路由与门禁校验', () => {
  let listener: NetworkListener;
  let validFrames: StreamFramePayload[] = [];
  let invalidFrames: { frame: StreamFramePayload; reason: string }[] = [];
  let onFrameValidMock: (frame: StreamFramePayload) => void;
  let onFrameInvalidMock: (frame: StreamFramePayload, reason: string) => void;

  beforeEach(() => {
    vi.useFakeTimers();
    validFrames = [];
    invalidFrames = [];
    onFrameValidMock = vi.fn((frame: StreamFramePayload) => {
      validFrames.push(frame);
    });
    onFrameInvalidMock = vi.fn((frame: StreamFramePayload, reason: string) => {
      invalidFrames.push({ frame, reason });
    });
    listener = new NetworkListener({
      allowedOrigin: 'https://chatgpt.com',
      onValidFrame: onFrameValidMock,
      onInvalidFrame: onFrameInvalidMock,
    });
    listener.start();
  });

  afterEach(() => {
    listener.destroy();
    vi.useRealTimers();
  });

  it('合法帧经 postMessage 到达后触发 onValidFrame 回调', () => {
    const msg: InterceptorMessage = {
      type: '__MULTI_AI_STREAM_FRAME__',
      payload: {
        streamId: 'stream-1',
        sequence: 1,
        url: 'https://chatgpt.com/backend-api/conversation',
        method: 'FETCH',
        rawText: 'data: {"message":{"content":{"parts":["Hello"]}}}\n\n',
        isDone: false,
        status: 'STREAMING',
        timestamp: Date.now(),
      },
    };

    window.dispatchEvent(new MessageEvent('message', {
      data: msg,
      origin: 'https://chatgpt.com',
    }));

    expect(validFrames.length).toBe(1);
    expect(validFrames[0]?.streamId).toBe('stream-1');
  });

  it('非 __MULTI_AI_STREAM_FRAME__ 类型的消息被忽略', () => {
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'OTHER_MESSAGE', payload: {} },
      origin: 'https://chatgpt.com',
    }));

    expect(validFrames.length).toBe(0);
  });

  it('超大帧（>8MB）被门禁拒绝，触发 onInvalidFrame', () => {
    const hugeText = 'X'.repeat(9 * 1024 * 1024); // 9MB > 8MB limit
    const msg: InterceptorMessage = {
      type: '__MULTI_AI_STREAM_FRAME__',
      payload: {
        streamId: 'stream-huge',
        sequence: 1,
        url: 'https://chatgpt.com/backend-api/conversation',
        method: 'FETCH',
        rawText: hugeText,
        isDone: false,
        status: 'STREAMING',
        timestamp: Date.now(),
      },
    };

    window.dispatchEvent(new MessageEvent('message', {
      data: msg,
      origin: 'https://chatgpt.com',
    }));

    expect(validFrames.length).toBe(0);
    expect(invalidFrames.length).toBe(1);
  });

  it('终端态后的延迟帧被门禁拒绝', () => {
    // 先发 sequence=1 普通帧（注册 streamId）
    const f1: InterceptorMessage = {
      type: '__MULTI_AI_STREAM_FRAME__',
      payload: {
        streamId: 'stream-term',
        sequence: 1,
        url: 'https://chatgpt.com/backend-api/conversation',
        method: 'FETCH',
        rawText: 'data: hello\n\n',
        isDone: false,
        status: 'STREAMING',
        timestamp: Date.now(),
      },
    };
    window.dispatchEvent(new MessageEvent('message', { data: f1, origin: 'https://chatgpt.com' }));

    // 再发终态帧
    const fDone: InterceptorMessage = {
      type: '__MULTI_AI_STREAM_FRAME__',
      payload: {
        streamId: 'stream-term',
        sequence: 2,
        url: 'https://chatgpt.com/backend-api/conversation',
        method: 'FETCH',
        rawText: '',
        isDone: true,
        status: 'DONE',
        timestamp: Date.now(),
      },
    };
    window.dispatchEvent(new MessageEvent('message', { data: fDone, origin: 'https://chatgpt.com' }));

    // 再发僵尸帧
    const fZombie: InterceptorMessage = {
      type: '__MULTI_AI_STREAM_FRAME__',
      payload: {
        streamId: 'stream-term',
        sequence: 3,
        url: 'https://chatgpt.com/backend-api/conversation',
        method: 'FETCH',
        rawText: 'data: zombie\n\n',
        isDone: false,
        status: 'STREAMING',
        timestamp: Date.now(),
      },
    };
    window.dispatchEvent(new MessageEvent('message', { data: fZombie, origin: 'https://chatgpt.com' }));

    // f1 + fDone 有效，fZombie 被拒
    expect(validFrames.length).toBe(2);
    expect(invalidFrames.length).toBe(1);
  });

  it('destroy() 后消息不再处理', () => {
    listener.destroy();

    const msg: InterceptorMessage = {
      type: '__MULTI_AI_STREAM_FRAME__',
      payload: {
        streamId: 'stream-after-destroy',
        sequence: 1,
        url: 'https://chatgpt.com/backend-api/conversation',
        method: 'FETCH',
        rawText: 'data: test\n\n',
        isDone: false,
        status: 'STREAMING',
        timestamp: Date.now(),
      },
    };
    window.dispatchEvent(new MessageEvent('message', {
      data: msg,
      origin: 'https://chatgpt.com',
    }));

    expect(validFrames.length).toBe(0);
  });
});
