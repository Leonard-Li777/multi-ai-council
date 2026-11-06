import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StreamOrchestrator } from '../lib/interceptor/stream-orchestrator';
import type { StreamFramePayload } from '../lib/types/interceptor';

describe('AC5, AC6, AC7: 双轨因果状态机与语义流编排 (StreamOrchestrator)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('捕获到合规 GENERATION 响应流立即上锁并挂起 DOM 监听', () => {
    const pauseDomSpy = vi.fn();
    const resumeDomSpy = vi.fn();

    const orchestrator = new StreamOrchestrator({
      onPauseDom: pauseDomSpy,
      onResumeDom: resumeDomSpy,
    });

    orchestrator.dispatchPrompt('task-1', '测试提示词');
    expect(orchestrator.getState()).toBe('PENDING_STREAM');

    // 收到合法主会话流 (SSE)
    const frame: StreamFramePayload = {
      streamId: 'stream-chat-1',
      sequence: 1,
      url: 'https://chatgpt.com/backend-api/conversation',
      method: 'FETCH',
      rawText: 'data: {"message":{"author":{"role":"assistant"},"content":{"parts":["hello"]}}}\n\n',
      isDone: false,
      status: 'STREAMING',
      timestamp: Date.now(),
    };

    orchestrator.handleStreamFrame(frame);
    expect(orchestrator.getState()).toBe('STREAMING');
    expect(orchestrator.getActiveStreamId()).toBe('stream-chat-1');
    expect(orchestrator.getResponseSnapshot()).toBe('hello');
    expect(pauseDomSpy).toHaveBeenCalled();
  });

  it('ChatGPT 全量快照模式下原子替换而不是盲目累加', () => {
    const orchestrator = new StreamOrchestrator();
    orchestrator.dispatchPrompt('task-1', '测试提示词');

    // 帧 1: "你好"
    orchestrator.handleStreamFrame({
      streamId: 'stream-chat-1',
      sequence: 1,
      url: 'https://chatgpt.com/backend-api/conversation',
      method: 'FETCH',
      rawText: 'data: {"message":{"author":{"role":"assistant"},"content":{"parts":["你好"]}}}\n\n',
      isDone: false,
      status: 'STREAMING',
      timestamp: Date.now(),
    });
    expect(orchestrator.getResponseSnapshot()).toBe('你好');

    // 帧 2: 全量快照更新为 "你好，世界！"
    orchestrator.handleStreamFrame({
      streamId: 'stream-chat-1',
      sequence: 2,
      url: 'https://chatgpt.com/backend-api/conversation',
      method: 'FETCH',
      rawText: 'data: {"message":{"author":{"role":"assistant"},"content":{"parts":["你好，世界！"]}}}\n\n',
      isDone: false,
      status: 'STREAMING',
      timestamp: Date.now(),
    });
    // 必须是快照覆盖，严禁变成 "你好你好，世界！"
    expect(orchestrator.getResponseSnapshot()).toBe('你好，世界！');
  });

  it('Defect 1 验证: ChatGPT Delta 模式下严禁 O(N^2) 字符膨胀', () => {
    const orchestrator = new StreamOrchestrator();
    orchestrator.dispatchPrompt('task-1', '测试提示词');

    // Delta 1: append "Hello"
    orchestrator.handleStreamFrame({
      streamId: 'stream-chat-delta',
      sequence: 1,
      url: 'https://chatgpt.com/backend-api/conversation',
      method: 'FETCH',
      rawText: 'event: delta\ndata: {"v":"Hello","p":"/message/content/parts/0","o":"append"}\n\n',
      isDone: false,
      status: 'STREAMING',
      timestamp: Date.now(),
    });
    expect(orchestrator.getResponseSnapshot()).toBe('Hello');

    // Delta 2: append " World"
    orchestrator.handleStreamFrame({
      streamId: 'stream-chat-delta',
      sequence: 2,
      url: 'https://chatgpt.com/backend-api/conversation',
      method: 'FETCH',
      rawText: 'event: delta\ndata: {"v":" World","p":"/message/content/parts/0","o":"append"}\n\n',
      isDone: false,
      status: 'STREAMING',
      timestamp: Date.now(),
    });
    // 必须是 "Hello World"，严禁变成 "HelloHello World"
    expect(orchestrator.getResponseSnapshot()).toBe('Hello World');
  });

  it('AC7: 主会话锁定期间，并发后台杂流 (/gen_title) 与 UNKNOWN 流 0 污染、0 覆盖', () => {
    const orchestrator = new StreamOrchestrator();
    orchestrator.dispatchPrompt('task-1', '测试提示词');

    // 1. 主流上锁
    orchestrator.handleStreamFrame({
      streamId: 'stream-main',
      sequence: 1,
      url: 'https://chatgpt.com/backend-api/conversation',
      method: 'FETCH',
      rawText: 'data: {"message":{"author":{"role":"assistant"},"content":{"parts":["主回答内容"]}}}\n\n',
      isDone: false,
      status: 'STREAMING',
      timestamp: Date.now(),
    });

    // 2. 并发杂流 /gen_title 到来
    const titleFrame: StreamFramePayload = {
      streamId: 'stream-title-bg',
      sequence: 1,
      url: 'https://chatgpt.com/backend-api/conversation/gen_title',
      method: 'FETCH',
      rawText: 'data: {"title":"新标题"}\n\n',
      isDone: true,
      status: 'DONE',
      timestamp: Date.now(),
    };

    orchestrator.handleStreamFrame(titleFrame);

    // 验证主流仍被锁住，未被篡夺，内容无污染
    expect(orchestrator.getActiveStreamId()).toBe('stream-main');
    expect(orchestrator.getResponseSnapshot()).toBe('主回答内容');
    expect(orchestrator.getState()).toBe('STREAMING');
  });

  it('AC6: 用户主动 Stop (PARTIAL / PAGE_ABORT) 时，释放锁并标记 PARTIAL', () => {
    const orchestrator = new StreamOrchestrator();
    orchestrator.dispatchPrompt('task-1', '测试提示词');

    orchestrator.handleStreamFrame({
      streamId: 'stream-main',
      sequence: 1,
      url: 'https://chatgpt.com/backend-api/conversation',
      method: 'FETCH',
      rawText: 'data: {"message":{"author":{"role":"assistant"},"content":{"parts":["半截回答"]}}}\n\n',
      isDone: false,
      status: 'STREAMING',
      timestamp: Date.now(),
    });

    // 收到用户 Stop 导致的 cancel
    orchestrator.handleStreamFrame({
      streamId: 'stream-main',
      sequence: 2,
      url: 'https://chatgpt.com/backend-api/conversation',
      method: 'FETCH',
      rawText: '',
      isDone: true,
      status: 'PARTIAL',
      endReason: 'PAGE_ABORT',
      timestamp: Date.now(),
    });

    expect(orchestrator.getState()).toBe('PARTIAL');
    expect(orchestrator.getActiveStreamId()).toBeNull(); // 锁已释放
    expect(orchestrator.getResponseSnapshot()).toBe('半截回答');
  });

  it('底层网络状态为 ERROR 时，状态机标记为 ERROR 而非 DONE', () => {
    const orchestrator = new StreamOrchestrator();
    orchestrator.dispatchPrompt('task-1', '测试提示词');

    orchestrator.handleStreamFrame({
      streamId: 'stream-err',
      sequence: 1,
      url: 'https://chatgpt.com/backend-api/conversation',
      method: 'FETCH',
      rawText: '',
      isDone: true,
      status: 'ERROR',
      endReason: 'PARSER_ERROR',
      timestamp: Date.now(),
    });

    expect(orchestrator.getState()).toBe('ERROR');
    expect(orchestrator.getActiveStreamId()).toBeNull();
  });

  it('AC4: DeepSeek 深度思考心跳持续刷新 TTFT 倒计时，不发生误超时降级', () => {
    const resumeDomSpy = vi.fn();
    const heartbeatSpy = vi.fn();

    const orchestrator = new StreamOrchestrator({
      onResumeDom: resumeDomSpy,
      onThinkingHeartbeat: heartbeatSpy,
    });

    orchestrator.dispatchPrompt('task-deepseek', '复杂数学证明');

    // 10 秒后收到第 1 个思考帧
    vi.advanceTimersByTime(10_000);
    orchestrator.handleStreamFrame({
      streamId: 'stream-ds-1',
      sequence: 1,
      url: 'https://chat.deepseek.com/api/v0/chat/completion',
      method: 'FETCH',
      rawText: 'data: {"choices":[{"delta":{"reasoning_content":"Step 1: 展开公式..."}}]}\n\n',
      isDone: false,
      status: 'STREAMING',
      timestamp: Date.now(),
    });

    expect(heartbeatSpy).toHaveBeenCalledWith('Step 1: 展开公式...');
    expect(orchestrator.getState()).toBe('STREAMING');

    // 又过了 10 秒 (累计 20s)，若没有心跳刷新则此时 15s 会超时；但由于刷新了，状态机保持 STREAMING
    vi.advanceTimersByTime(10_000);
    expect(orchestrator.getState()).toBe('STREAMING');
    expect(resumeDomSpy).not.toHaveBeenCalled();
  });

  it('AC5: 15s 超时未捕获到网络流且 DOM 有输出，平滑激活 DOM 兜底 (DOM_FALLBACK)', () => {
    const resumeDomSpy = vi.fn();
    const orchestrator = new StreamOrchestrator({
      onResumeDom: resumeDomSpy,
      checkDomHasContent: () => true, // 模拟 DOM 已有回答
    });

    orchestrator.dispatchPrompt('task-1', '测试提示词');
    expect(orchestrator.getState()).toBe('PENDING_STREAM');

    // 快进 15 秒抗高峰 TTFT
    vi.advanceTimersByTime(15_000);

    expect(orchestrator.getState()).toBe('DOM_FALLBACK');
    expect(resumeDomSpy).toHaveBeenCalled();
  });

  it('防覆盖安全机制：若收到独立分段快照（不含旧前缀），按段落追加而非擦除历史只剩最后一行', () => {
    const orchestrator = new StreamOrchestrator();
    orchestrator.dispatchPrompt('task-qwen', '长文提问');

    // 第 1 段长快照 (ChatGPT/Qwen)
    orchestrator.handleStreamFrame({
      streamId: 'stream-snap-1',
      sequence: 1,
      url: 'https://chatgpt.com/backend-api/conversation',
      method: 'FETCH',
      rawText: 'data: {"message":{"author":{"role":"assistant"},"content":{"parts":["第一段非常详尽的长篇解答，包含丰富的论据和推导过程。"]}}}\n\n',
      isDone: false,
      status: 'STREAMING',
      timestamp: Date.now(),
    });
    expect(orchestrator.getResponseSnapshot()).toContain('第一段非常详尽');

    // 第 2 段独立分段快照（短，不以第一段开头）
    orchestrator.handleStreamFrame({
      streamId: 'stream-snap-1',
      sequence: 2,
      url: 'https://chatgpt.com/backend-api/conversation',
      method: 'FETCH',
      rawText: 'data: {"message":{"author":{"role":"assistant"},"content":{"parts":["第二段总结：结论成立。"]}}}\n\n',
      isDone: false,
      status: 'STREAMING',
      timestamp: Date.now(),
    });

    // 关键断言：第一段保留，第二段追加，绝未被抹去只剩最后一行！
    expect(orchestrator.getResponseSnapshot()).toContain('第一段非常详尽');
    expect(orchestrator.getResponseSnapshot()).toContain('第二段总结：结论成立。');
  });
});
