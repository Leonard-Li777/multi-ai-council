import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAdapterBridge } from '../lib/interceptor/adapter-bridge';
import type { PortMessage } from '../lib/messaging/port';
import type { StreamFramePayload } from '../lib/types/interceptor';

/**
 * AC-NL2: AdapterBridge 语义事件 → PortMessage 转换
 */
describe('AC-NL2: AdapterBridge 语义事件 → PortMessage 转换', () => {
  let sentMessages: PortMessage[] = [];
  let sendMock: (msg: PortMessage) => void;

  beforeEach(() => {
    vi.useFakeTimers();
    sentMessages = [];
    sendMock = vi.fn((msg: PortMessage) => {
      sentMessages.push(msg);
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('SNAPSHOT 语义事件 → STREAM_UPDATE (isFinished: false)', () => {
    const { orchestrator } = createAdapterBridge({
      siteName: 'ChatGPT',
      jobId: 'job-1',
      sendFn: sendMock,
      url: 'https://chatgpt.com/backend-api/conversation',
    });

    orchestrator.dispatchPrompt('job-1', '测试提示词');

    // 发入合法流帧（触发 CHATGPT 解析 → SNAPSHOT 事件）
    const frame: StreamFramePayload = {
      streamId: 'stream-bridge-1',
      sequence: 1,
      url: 'https://chatgpt.com/backend-api/conversation',
      method: 'FETCH',
      rawText: 'data: {"message":{"author":{"role":"assistant"},"content":{"parts":["你好"]},"status":"in_progress"}}\n\n',
      isDone: false,
      status: 'STREAMING',
      timestamp: Date.now(),
    };
    orchestrator.handleStreamFrame(frame);

    // 应该收到 STREAM_UPDATE
    const streamUpdates = sentMessages.filter(
      (msg) => msg.type === 'STREAM_UPDATE'
    );
    expect(streamUpdates.length).toBeGreaterThan(0);
    const lastUpdate = streamUpdates[streamUpdates.length - 1]!;
    expect(lastUpdate.type).toBe('STREAM_UPDATE');
    if (lastUpdate.type === 'STREAM_UPDATE') {
      expect(lastUpdate.payload.isFinished).toBe(false);
      expect(lastUpdate.payload.siteName).toBe('ChatGPT');
      expect(lastUpdate.payload.jobId).toBe('job-1');
    }
  });

  it('DONE 语义事件 → STREAM_UPDATE (isFinished: true) + STATUS_CHANGE (DONE)', () => {
    const { orchestrator } = createAdapterBridge({
      siteName: 'DeepSeek',
      jobId: 'job-deepseek',
      sendFn: sendMock,
      url: 'https://chat.deepseek.com/api/v0/chat/completion',
    });

    orchestrator.dispatchPrompt('job-deepseek', '测试');

    // 发增量帧
    const f1: StreamFramePayload = {
      streamId: 'ds-stream-1',
      sequence: 1,
      url: 'https://chat.deepseek.com/api/v0/chat/completion',
      method: 'FETCH',
      rawText: 'data: {"choices":[{"delta":{"content":"Hello"},"finish_reason":null}]}\n\n',
      isDone: false,
      status: 'STREAMING',
      timestamp: Date.now(),
    };
    orchestrator.handleStreamFrame(f1);

    // 发终态帧
    const fDone: StreamFramePayload = {
      streamId: 'ds-stream-1',
      sequence: 2,
      url: 'https://chat.deepseek.com/api/v0/chat/completion',
      method: 'FETCH',
      rawText: 'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
      isDone: true,
      status: 'DONE',
      timestamp: Date.now(),
    };
    orchestrator.handleStreamFrame(fDone);

    const statusChanges = sentMessages.filter(
      (msg) => msg.type === 'STATUS_CHANGE'
    );
    const doneChange = statusChanges.find(
      (msg) => msg.type === 'STATUS_CHANGE' && msg.payload.status === 'DONE'
    );
    expect(doneChange).toBeDefined();
  });

  it('PARTIAL 终态 → STATUS_CHANGE (PARTIAL)', () => {
    const { orchestrator } = createAdapterBridge({
      siteName: 'Claude',
      jobId: 'job-claude',
      sendFn: sendMock,
      url: 'https://claude.ai/api/organizations/org-123/completion',
    });

    orchestrator.dispatchPrompt('job-claude', '测试');

    // 发增量帧（先注册 streamId）
    const f1: StreamFramePayload = {
      streamId: 'claude-stream',
      sequence: 1,
      url: 'https://claude.ai/api/organizations/org-123/completion',
      method: 'FETCH',
      rawText: 'event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"Hi"}}\n\n',
      isDone: false,
      status: 'STREAMING',
      timestamp: Date.now(),
    };
    orchestrator.handleStreamFrame(f1);

    // 发 PARTIAL 终态
    const fPartial: StreamFramePayload = {
      streamId: 'claude-stream',
      sequence: 2,
      url: 'https://claude.ai/api/organizations/org-123/completion',
      method: 'FETCH',
      rawText: '',
      isDone: true,
      status: 'PARTIAL',
      endReason: 'PAGE_ABORT',
      timestamp: Date.now(),
    };
    orchestrator.handleStreamFrame(fPartial);

    const statusChanges = sentMessages.filter((msg) => msg.type === 'STATUS_CHANGE');
    const partialChange = statusChanges.find(
      (msg) => msg.type === 'STATUS_CHANGE' && msg.payload.status === 'PARTIAL'
    );
    expect(partialChange).toBeDefined();
  });

  it('bridge 拿到的 orchestrator 状态可供外部用于 DOM_FALLBACK 判定', () => {
    const { orchestrator } = createAdapterBridge({
      siteName: 'Gemini',
      jobId: 'job-gemini',
      sendFn: sendMock,
      url: 'https://gemini.google.com/StreamGenerate',
    });

    orchestrator.dispatchPrompt('job-gemini', '测试');
    expect(orchestrator.getState()).toBe('PENDING_STREAM');
  });
});
