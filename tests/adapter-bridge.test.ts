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

  it('15s 超时未捕获到流时，AdapterBridge 自动激活 onDomFallback 回调', () => {
    const fallbackSpy = vi.fn();
    const { orchestrator } = createAdapterBridge({
      siteName: 'Wenxin',
      jobId: 'job-wenxin',
      sendFn: sendMock,
      url: 'https://yiyan.baidu.com/eb/chat/conversation',
      onDomFallback: fallbackSpy,
    });

    orchestrator.dispatchPrompt('job-wenxin', '测试');
    expect(fallbackSpy).not.toHaveBeenCalled();

    // 15 秒过去，未收到任何网络流
    vi.advanceTimersByTime(15_000);
    expect(fallbackSpy).toHaveBeenCalledOnce();
  });

  it('网络流 DONE 但正文提取为空时（如字段漂移），防空门禁自动触发 onDomFallback', () => {
    const fallbackSpy = vi.fn();
    const { orchestrator } = createAdapterBridge({
      siteName: 'DeepSeek',
      jobId: 'job-ds-empty',
      sendFn: sendMock,
      url: 'https://chat.deepseek.com/api/v0/chat/completion',
      onDomFallback: fallbackSpy,
    });

    orchestrator.dispatchPrompt('job-ds-empty', '测试');

    // 收到一个空内容的流结束帧
    const emptyDoneFrame: StreamFramePayload = {
      streamId: 'ds-empty-stream',
      sequence: 1,
      url: 'https://chat.deepseek.com/api/v0/chat/completion',
      method: 'FETCH',
      rawText: 'data: [DONE]\n\n',
      isDone: true,
      status: 'DONE',
      timestamp: Date.now(),
    };
    orchestrator.handleStreamFrame(emptyDoneFrame);

    // 防空门禁生效：不派发空的 DONE，而是触发 onDomFallback 尝试 DOM 恢复
    expect(fallbackSpy).toHaveBeenCalledOnce();
    const doneChange = sentMessages.find(
      (msg) => msg.type === 'STATUS_CHANGE' && msg.payload.status === 'DONE'
    );
    expect(doneChange).toBeUndefined();
  });

  it('双轨伴生收敛：网络层未出字时，DOM 流式更新平滑推送 (handleDomUpdate)', () => {
    const bridge = createAdapterBridge({
      siteName: 'Gemini',
      jobId: 'job-gemini-stream',
      sendFn: sendMock,
      url: 'https://gemini.google.com/StreamGenerate',
    });

    bridge.handleDomUpdate('正在思考中...', '正在思考中...');

    const updates = sentMessages.filter((msg) => msg.type === 'STREAM_UPDATE');
    expect(updates.length).toBe(1);
    if (updates[0] && updates[0].type === 'STREAM_UPDATE') {
      expect(updates[0].payload.snapshot).toBe('正在思考中...');
      expect(updates[0].payload.isFinished).toBe(false);
    }
  });

  it('双轨伴生收敛：DOM 哨兵判定完成时，若网络层缺失内容则采纳 DOM 内容 (handleDomDone)', () => {
    const bridge = createAdapterBridge({
      siteName: 'Wenxin',
      jobId: 'job-wenxin-done',
      sendFn: sendMock,
      url: 'https://yiyan.baidu.com/eb/chat/conversation',
    });

    // 网络层未捕获到请求（accumulatedSnapshot 为空），DOM 检测到停止按钮消失与稳定内容
    bridge.handleDomDone('这是文心一言完整的回答内容，包含很多关键信息。', 'https://yiyan.baidu.com/c/123');

    const doneChange = sentMessages.find(
      (msg) => msg.type === 'STATUS_CHANGE' && msg.payload.status === 'DONE'
    );
    expect(doneChange).toBeDefined();
    if (doneChange && doneChange.type === 'STATUS_CHANGE') {
      expect(doneChange.payload.conversationUrl).toBe('https://yiyan.baidu.com/c/123');
    }

    const lastStreamUpdate = sentMessages.filter((msg) => msg.type === 'STREAM_UPDATE').pop();
    expect(lastStreamUpdate).toBeDefined();
    if (lastStreamUpdate && lastStreamUpdate.type === 'STREAM_UPDATE') {
      expect(lastStreamUpdate.payload.isFinished).toBe(true);
      expect(lastStreamUpdate.payload.cleaned).toContain('这是文心一言完整的回答内容');
    }
    expect(bridge.isCompleted()).toBe(true);
  });

  it('双轨伴生收敛：若网络层已有大段文本，DOM 完成时优先以纯净网络快照收敛', () => {
    const bridge = createAdapterBridge({
      siteName: 'Claude',
      jobId: 'job-claude-priority',
      sendFn: sendMock,
      url: 'https://claude.ai/api/organizations/org-123/completion',
    });
    bridge.orchestrator.dispatchPrompt('job-claude-priority', '测试');

    // 模拟网络层捕获了 100 字的高质量文本
    const netFrame: StreamFramePayload = {
      streamId: 'cl-net-1',
      sequence: 1,
      url: 'https://claude.ai/api/organizations/org-123/completion',
      method: 'FETCH',
      rawText: 'event: content_block_delta\ndata: {"delta":{"type":"text_delta","text":"来自网络层的纯净 Markdown 正文，长度足够长且无 DOM 复制杂音。"}}\n\n',
      isDone: false,
      status: 'STREAMING',
      timestamp: Date.now(),
    };
    bridge.orchestrator.handleStreamFrame(netFrame);

    // DOM 此时触发了 onDone（可能包含少许 DOM 噪声或等长）
    bridge.handleDomDone('来自 DOM 的正文，可能带有复制按钮等杂音。', 'https://claude.ai/chat/1');

    const lastStreamUpdate = sentMessages.filter((msg) => msg.type === 'STREAM_UPDATE').pop();
    expect(lastStreamUpdate).toBeDefined();
    if (lastStreamUpdate && lastStreamUpdate.type === 'STREAM_UPDATE') {
      expect(lastStreamUpdate.payload.isFinished).toBe(true);
      // 应该保留网络层的纯净正文
      expect(lastStreamUpdate.payload.snapshot).toContain('来自网络层的纯净 Markdown 正文');
    }
  });
});
