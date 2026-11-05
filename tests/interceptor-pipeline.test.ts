import { describe, it, expect, vi } from 'vitest';
import { createStreamTransformPipeline } from '../lib/interceptor/stream-pipeline';

describe('AC-SEMANTICS & Fail-Open: TransformStream 原位单管道透传生命周期', () => {
  it('透传数据并对旁路异常 Fail-Open，绝不击穿宿主流', async () => {
    const errorSpy = vi.fn();
    const capturedChunks: string[] = [];

    const pipeline = createStreamTransformPipeline({
      streamId: 'test-stream-1',
      url: 'https://api.example.com/chat',
      method: 'FETCH',
      onFrame: (frame) => {
        capturedChunks.push(frame.rawText);
        if (frame.rawText.includes('CRASH')) {
          throw new Error('旁路解析器意外崩溃');
        }
      },
      onError: errorSpy,
    });

    const encoder = new TextEncoder();
    const sourceStream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('chunk 1; '));
        controller.enqueue(encoder.encode('CRASH CHUNK; '));
        controller.enqueue(encoder.encode('chunk 3; '));
        controller.close();
      },
    });

    // 管道透传
    const transformed = sourceStream.pipeThrough(pipeline);
    const reader = transformed.getReader();
    const decoder = new TextDecoder();
    let hostReceived = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      hostReceived += decoder.decode(value);
    }

    // 宿主前端应 100% 正常收到所有块（包含 CRASH CHUNK）
    expect(hostReceived).toBe('chunk 1; CRASH CHUNK; chunk 3; ');
    // 旁路异常被捕获，fail-open 记录，宿主未抛错
    expect(errorSpy).toHaveBeenCalled();
  });

  it('宿主流正常 EOF 结束时，触发 flush 并派发 status: DONE 与 endReason: EOF', async () => {
    const frames: any[] = [];
    const pipeline = createStreamTransformPipeline({
      streamId: 'test-stream-2',
      url: 'https://api.example.com/chat',
      method: 'FETCH',
      onFrame: (frame) => frames.push(frame),
    });

    const encoder = new TextEncoder();
    const sourceStream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('hello world'));
        controller.close();
      },
    });

    const reader = sourceStream.pipeThrough(pipeline).getReader();
    while (!(await reader.read()).done) {}

    const terminalFrame = frames.find((f) => f.isDone);
    expect(terminalFrame).toBeDefined();
    expect(terminalFrame?.status).toBe('DONE');
    expect(terminalFrame?.endReason).toBe('EOF');
  });

  it('宿主主动 cancel / Stop 时，触发 cancel 钩子并派发 status: PARTIAL, isDone: true, endReason: PAGE_ABORT', async () => {
    const frames: any[] = [];
    const pipeline = createStreamTransformPipeline({
      streamId: 'test-stream-3',
      url: 'https://api.example.com/chat',
      method: 'FETCH',
      onFrame: (frame) => frames.push(frame),
    });

    const encoder = new TextEncoder();
    const sourceStream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('starting... '));
        // 不 close，保持流打开
      },
    });

    const reader = sourceStream.pipeThrough(pipeline).getReader();
    await reader.read();

    // 模拟宿主用户点击网页端的 Stop 按钮或取消请求
    await reader.cancel('User clicked Stop');

    const abortFrame = frames.find((f) => f.isDone);
    expect(abortFrame).toBeDefined();
    expect(abortFrame?.status).toBe('PARTIAL');
    expect(abortFrame?.isDone).toBe(true);
    expect(abortFrame?.endReason).toBe('PAGE_ABORT');
  });
});
