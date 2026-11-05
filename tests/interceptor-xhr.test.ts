import { describe, it, expect, vi } from 'vitest';
import { XhrProxyHandler } from '../lib/interceptor/xhr-proxy';

describe('AC8 & AC-PERF: XMLHttpRequest 原型代理与双事件增量切片', () => {
  it('在 responseType 为 text 或空串时正常切片，在非文本类型下安全跳过 0 抛异常', () => {
    const handler = new XhrProxyHandler({
      onFrame: vi.fn(),
    });

    // 模拟 arraybuffer 响应
    const mockBinaryXhr = {
      responseType: 'arraybuffer',
      response: new ArrayBuffer(8),
      readyState: 3,
    } as any;

    expect(() => {
      handler.handleProgress(mockBinaryXhr, 'https://gemini.google.com/rpc');
    }).not.toThrow();
  });

  it('progress 与 readystatechange(3/4) 协同切片 0 漏帧且 0 重复', () => {
    const frames: string[] = [];
    let isDoneSignaled = false;

    const handler = new XhrProxyHandler({
      onFrame: (frame) => {
        if (frame.rawText) frames.push(frame.rawText);
        if (frame.isDone) isDoneSignaled = true;
      },
    });

    const mockXhr = {
      responseType: '',
      responseText: '',
      readyState: 1,
    } as any;

    // 增量 1: progress 触发
    mockXhr.responseText = 'chunk 1; ';
    mockXhr.readyState = 3;
    handler.handleProgress(mockXhr, 'https://gemini.google.com/rpc');

    // 增量 1 重复触发 readystatechange (数据无变化)
    handler.handleReadyStateChange(mockXhr, 'https://gemini.google.com/rpc');
    expect(frames).toEqual(['chunk 1; ']);

    // 增量 2: progress 累积追加
    mockXhr.responseText = 'chunk 1; chunk 2; ';
    handler.handleProgress(mockXhr, 'https://gemini.google.com/rpc');
    expect(frames).toEqual(['chunk 1; ', 'chunk 2; ']);

    // 终态: readyState 4 完成
    mockXhr.responseText = 'chunk 1; chunk 2; chunk 3 (end)';
    mockXhr.readyState = 4;
    mockXhr.status = 200;
    handler.handleReadyStateChange(mockXhr, 'https://gemini.google.com/rpc');

    expect(frames).toEqual(['chunk 1; ', 'chunk 2; ', 'chunk 3 (end)']);
    expect(isDoneSignaled).toBe(true);
  });

  it('H-01: XHR 被 abort 时 (readyState 4 但 status 0)，派发 status: PARTIAL 与 endReason: PAGE_ABORT', () => {
    let finalFrame: any = null;

    const handler = new XhrProxyHandler({
      onFrame: (frame) => {
        if (frame.isDone) finalFrame = frame;
      },
    });

    const mockXhr = {
      responseType: 'text',
      responseText: 'half finished text',
      readyState: 3,
      status: 200,
    } as any;

    handler.handleProgress(mockXhr, 'https://gemini.google.com/rpc');

    // 模拟 abort: readyState 4, status 0
    mockXhr.readyState = 4;
    mockXhr.status = 0;
    handler.handleReadyStateChange(mockXhr, 'https://gemini.google.com/rpc');

    expect(finalFrame).toBeDefined();
    expect(finalFrame.status).toBe('PARTIAL');
    expect(finalFrame.endReason).toBe('PAGE_ABORT');
  });

  it('AC-PERF: 50 万字符 XHR 增量切片总耗时基准 < 200ms', () => {
    const handler = new XhrProxyHandler({
      onFrame: () => {},
    });

    const mockXhr = {
      responseType: 'text',
      responseText: '',
      readyState: 3,
    } as any;

    // 构造 50 万字符的大型文本，分 50 次增量切片灌入（每次 1 万字符）
    const totalChars = 500_000;
    const stepSize = 10_000;
    const chunkString = 'a'.repeat(stepSize);

    const startTime = performance.now();
    for (let current = stepSize; current <= totalChars; current += stepSize) {
      mockXhr.responseText += chunkString;
      handler.handleProgress(mockXhr, 'https://gemini.google.com/rpc');
    }
    mockXhr.readyState = 4;
    handler.handleReadyStateChange(mockXhr, 'https://gemini.google.com/rpc');
    const totalDuration = performance.now() - startTime;

    expect(totalDuration).toBeLessThan(200); // 必须在 200ms 内完成，无性能劣化
  });
});
