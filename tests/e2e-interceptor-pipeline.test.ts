import { describe, it, expect, vi, beforeEach } from 'vitest';
import { StreamOrchestrator } from '../lib/interceptor/stream-orchestrator';
import { StreamFrameValidator } from '../lib/interceptor/frame-validator';
import { MAX_STREAM_FRAME_SIZE, type StreamFramePayload } from '../lib/types/interceptor';

describe('AC-FRAME-LIMIT, AC10b, AC9: 全链路端到端拦截与安全防御回归', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('AC10b: 网页端伪造 postMessage 注入端到端防御', () => {
    it('网页注入伪造未注册 streamId 的 isDone: true 时，扩展拦截且状态机不推进', () => {
      const validator = new StreamFrameValidator({ allowedOrigin: 'https://chatgpt.com' });
      const orchestrator = new StreamOrchestrator();

      orchestrator.dispatchPrompt('job-1', '测试提示词');
      expect(orchestrator.getState()).toBe('PENDING_STREAM');

      // 攻击者伪造直接完成帧
      const forgedFrame: StreamFramePayload = {
        streamId: 'forged-attacker-stream',
        sequence: 1,
        url: 'https://chatgpt.com/backend-api/conversation',
        method: 'FETCH',
        rawText: '',
        isDone: true,
        status: 'DONE',
        timestamp: Date.now(),
      };

      // 经过管道层门卫
      const valRes = validator.validateFrame(forgedFrame, 'https://chatgpt.com');
      expect(valRes.valid).toBe(false);

      // 若被拦截，状态机绝不处理
      if (valRes.valid) {
        orchestrator.handleStreamFrame(forgedFrame);
      }

      // 验证状态机仍处于等待合法流状态，0 被污染
      expect(orchestrator.getState()).toBe('PENDING_STREAM');
      expect(orchestrator.getActiveStreamId()).toBeNull();
    });

    it('超大 10MB 伪造攻击报文在门禁层被拦截丢弃，不导致内存膨胀与状态推进', () => {
      const validator = new StreamFrameValidator({ allowedOrigin: 'https://chatgpt.com' });
      const orchestrator = new StreamOrchestrator();

      orchestrator.dispatchPrompt('job-2', '测试提示词');

      // 构造超大 10MB 攻击帧
      const attackerHugeText = 'A'.repeat(10 * 1024 * 1024);
      const hugeFrame: StreamFramePayload = {
        streamId: 'huge-stream-attack',
        sequence: 1,
        url: 'https://chatgpt.com/backend-api/conversation',
        method: 'FETCH',
        rawText: attackerHugeText,
        isDone: false,
        status: 'STREAMING',
        timestamp: Date.now(),
      };

      const valRes = validator.validateFrame(hugeFrame, 'https://chatgpt.com');
      expect(valRes.valid).toBe(false);
      expect(valRes.reason).toContain('超限');

      expect(orchestrator.getState()).toBe('PENDING_STREAM');
    });

    it('流终止后延迟到来的僵尸增量帧 100% 丢弃，0 状态污染', () => {
      const validator = new StreamFrameValidator({ allowedOrigin: 'https://chatgpt.com' });
      const orchestrator = new StreamOrchestrator();

      orchestrator.dispatchPrompt('job-3', '测试提示词');

      // 1. 正常开始
      const f1: StreamFramePayload = {
        streamId: 'stream-legit',
        sequence: 1,
        url: 'https://chatgpt.com/backend-api/conversation',
        method: 'FETCH',
        rawText: 'data: {"message":{"author":{"role":"assistant"},"content":{"parts":["正常开始"]}}}\n\n',
        isDone: false,
        status: 'STREAMING',
        timestamp: Date.now(),
      };
      expect(validator.validateFrame(f1, 'https://chatgpt.com').valid).toBe(true);
      orchestrator.handleStreamFrame(f1);

      // 2. 正常终结 (PARTIAL)
      const fDone: StreamFramePayload = {
        streamId: 'stream-legit',
        sequence: 2,
        url: 'https://chatgpt.com/backend-api/conversation',
        method: 'FETCH',
        rawText: '',
        isDone: true,
        status: 'PARTIAL',
        endReason: 'PAGE_ABORT',
        timestamp: Date.now(),
      };
      expect(validator.validateFrame(fDone, 'https://chatgpt.com').valid).toBe(true);
      orchestrator.handleStreamFrame(fDone);
      expect(orchestrator.getState()).toBe('PARTIAL');

      // 3. 延迟到来的僵尸帧
      const fZombie: StreamFramePayload = {
        streamId: 'stream-legit',
        sequence: 3,
        url: 'https://chatgpt.com/backend-api/conversation',
        method: 'FETCH',
        rawText: 'data: {"message":{"author":{"role":"assistant"},"content":{"parts":["延迟僵尸数据"]}}}\n\n',
        isDone: false,
        status: 'STREAMING',
        timestamp: Date.now(),
      };
      const zombieVal = validator.validateFrame(fZombie, 'https://chatgpt.com');
      expect(zombieVal.valid).toBe(false);
      expect(zombieVal.reason).toContain('终端态');

      // 状态机内容保持原始快照，0 污染
      expect(orchestrator.getResponseSnapshot()).toBe('正常开始');
      expect(orchestrator.getState()).toBe('PARTIAL');
    });
  });

  describe('AC-FRAME-LIMIT: 单帧阈值与超长报文自适应放行', () => {
    it('在合法大报文 (如 2MB~3MB 长文) 下通过管道门卫，正文 0 丢失', () => {
      const validator = new StreamFrameValidator({ allowedOrigin: 'https://gemini.google.com' });
      const orchestrator = new StreamOrchestrator();

      orchestrator.dispatchPrompt('job-gemini', '长篇论文生成');

      // 构造 2.5MB 合法长文本
      const longText = 'Gemini long output chunk'.repeat(100_000); // ~2.4MB
      const frame: StreamFramePayload = {
        streamId: 'gemini-long-1',
        sequence: 1,
        url: 'https://gemini.google.com/StreamGenerate',
        method: 'XHR',
        rawText: `)]}'\n\n[["wrb.fr",null,[null,null,null,null,[["rc_1",["${longText}"]]]]]]`,
        isDone: false,
        status: 'STREAMING',
        timestamp: Date.now(),
      };

      const valRes = validator.validateFrame(frame, 'https://gemini.google.com');
      expect(valRes.valid).toBe(true);

      orchestrator.handleStreamFrame(frame);
      expect(orchestrator.getState()).toBe('STREAMING');
      expect(orchestrator.getResponseSnapshot()).toBe(longText);
    });
  });

  describe('AC9: Service Worker 重启与会话级持久化幂等恢复', () => {
    it('在流式中间状态下通过 restoreSession 重水化，能精准恢复历史快照且后续增量无缝追加', () => {
      // 模拟第 1 阶段：SW 存活时处理了前 2 个 token
      const o1 = new StreamOrchestrator();
      o1.dispatchPrompt('job-sw', '提示词');

      o1.handleStreamFrame({
        streamId: 'stream-sw-1',
        sequence: 1,
        url: 'https://chat.deepseek.com/api/v0/chat/completion',
        method: 'FETCH',
        rawText: 'data: {"choices":[{"delta":{"content":"前半部分"}}]}\n\n',
        isDone: false,
        status: 'STREAMING',
        timestamp: Date.now(),
      });

      const snapshotBeforeSleep = o1.getResponseSnapshot();
      expect(snapshotBeforeSleep).toBe('前半部分');

      // 模拟 SW 30s 回收后重启：从持久化缓存中恢复快照与活跃流
      const o2 = new StreamOrchestrator();
      o2.restoreSession({
        jobId: 'job-sw',
        streamId: 'stream-sw-1',
        responseSnapshot: snapshotBeforeSleep,
        prompt: '提示词',
        url: 'https://chat.deepseek.com/api/v0/chat/completion',
      });

      expect(o2.getState()).toBe('STREAMING');
      expect(o2.getResponseSnapshot()).toBe('前半部分');

      // 模拟后续流增量灌入
      o2.handleStreamFrame({
        streamId: 'stream-sw-1',
        sequence: 2,
        url: 'https://chat.deepseek.com/api/v0/chat/completion',
        method: 'FETCH',
        rawText: 'data: {"choices":[{"delta":{"content":"后半部分"}}]}\n\n',
        isDone: true,
        status: 'DONE',
        timestamp: Date.now(),
      });

      // 真实无缝接续断言：前半部分 + 后半部分，0 丢失、0 重复！
      expect(o2.getResponseSnapshot()).toBe('前半部分后半部分');
      expect(o2.getState()).toBe('DONE');
    });
  });
});
