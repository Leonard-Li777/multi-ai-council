// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { geminiAdapter } from '../lib/adapters/gemini.adapter';
import { updateProviderRun, getActiveJob, saveActiveJob } from '../lib/storage/job-store';
import { calculateQuorumProgress } from '../lib/utils/quorum-calculator';
import type { ReviewJob } from '../lib/types/review-job';

describe('Manual Override & Gemini New Chat Tests', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    const sessionMap = new Map<string, any>();
    (globalThis as any).chrome = {
      storage: {
        session: {
          get: vi.fn(async (key: string) => ({ [key]: sessionMap.get(key) })),
          set: vi.fn(async (obj: Record<string, any>) => {
            for (const [k, v] of Object.entries(obj)) {
              sessionMap.set(k, v);
            }
          }),
          remove: vi.fn(async (key: string) => {
            sessionMap.delete(key);
          }),
        },
      },
    };
  });

  describe('GeminiAdapter createNewChat & hasExistingMessages', () => {
    it('当 URL 带有会话路径 /app/c_123 时判定为存在历史会话', () => {
      // Mock pathname
      window.history.pushState({}, '', '/app/c_123456');
      expect(geminiAdapter.hasExistingMessages()).toBe(true);
    });

    it('当 DOM 中存在 user-query 或 model-response 时判定为存在历史会话', () => {
      window.history.pushState({}, '', '/app');
      expect(geminiAdapter.hasExistingMessages()).toBe(false);

      const msg = document.createElement('user-query');
      document.body.appendChild(msg);
      expect(geminiAdapter.hasExistingMessages()).toBe(true);
    });

    it('能正确识别包含快捷键或图标文字的 New Chat 按钮并触发点击', async () => {
      window.history.pushState({}, '', '/app/c_existing');

      const btn = document.createElement('button');
      btn.setAttribute('aria-label', 'New chat (Ctrl + Shift + O)');
      btn.innerHTML = '<mat-icon>add</mat-icon><span>New chat</span>';
      document.body.appendChild(btn);

      let clicked = false;
      btn.addEventListener('click', () => {
        clicked = true;
      });

      await geminiAdapter.createNewChat();
      expect(clicked).toBe(true);
    });

    it('能正确识别 a[href="/app"] 标签形式的导航链接', async () => {
      window.history.pushState({}, '', '/app/c_existing2');

      const link = document.createElement('a');
      link.setAttribute('href', '/app');
      link.setAttribute('aria-label', '新对话');
      document.body.appendChild(link);

      let clicked = false;
      link.addEventListener('click', (e) => {
        e.preventDefault();
        clicked = true;
      });

      await geminiAdapter.createNewChat();
      expect(clicked).toBe(true);
    });
  });

  describe('Manual Override in JobStore & Quorum Convergence', () => {
    it('手动覆盖回复后，站点状态转为 DONE 并能防御迟到的 STREAMING 覆写', async () => {
      const jobId = 'test-job-manual-' + Date.now();
      const mockJob: ReviewJob = {
        id: jobId,
        originalPrompt: '请帮我 review 架构方案',
        isContinuation: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        deadlineAt: Date.now() + 90000,
        aggregationPolicy: {
          minCompletedProviders: 2,
          allowPartialAggregation: true,
          judgeProvider: 'DeepSeek',
          enabledSites: ['DeepSeek', 'ChatGPT', 'Gemini'],
        },
        providerRuns: {
          DeepSeek: {
            siteName: 'DeepSeek',
            status: 'DONE',
            responseSnapshot: 'DeepSeek 完整答复',
            cleanedResponse: 'DeepSeek 完整答复',
            retryCount: 0,
          },
          ChatGPT: {
            siteName: 'ChatGPT',
            status: 'STREAMING',
            responseSnapshot: '',
            cleanedResponse: '',
            retryCount: 0,
          },
          Gemini: {
            siteName: 'Gemini',
            status: 'FAILED',
            errorReason: '超时未响应',
            responseSnapshot: '',
            cleanedResponse: '',
            retryCount: 0,
          },
        },
        active: true,
      };

      await saveActiveJob(mockJob);

      // 此时 Quorum 只有 1 个完成，门槛为 2
      let quorum = calculateQuorumProgress(mockJob);
      expect(quorum.completedCount).toBe(1);
      expect(quorum.canFastForward).toBe(false);

      // 用户手动粘贴 ChatGPT 回复
      const manualText = '用户手动从 ChatGPT 网页复制并粘贴回来的 5000 字完整审查结论...';
      const updated = await updateProviderRun(jobId, 'ChatGPT', {
        responseSnapshot: manualText,
        cleanedResponse: manualText,
        status: 'DONE',
        errorReason: undefined,
        completedAt: Date.now(),
      });

      expect(updated).not.toBeNull();
      expect(updated?.providerRuns['ChatGPT']?.status).toBe('DONE');
      expect(updated?.providerRuns['ChatGPT']?.cleanedResponse).toBe(manualText);

      // Quorum 进度应立即收敛为 2 个完成，满足最低门槛，且全部站点已结算完成 (isAllSettled)
      quorum = calculateQuorumProgress(updated!);
      expect(quorum.completedCount).toBe(2);
      expect(quorum.isQuorumReached).toBe(true);
      expect(quorum.isAllSettled).toBe(true);

      // 验证终态保护：迟到的旧流式 STREAMING 消息不能将已 DONE 的状态倒退
      const lateStream = await updateProviderRun(jobId, 'ChatGPT', {
        status: 'STREAMING',
        responseSnapshot: '迟到的旧内容',
      });

      expect(lateStream?.providerRuns['ChatGPT']?.status).toBe('DONE');
      expect(lateStream?.providerRuns['ChatGPT']?.cleanedResponse).toBe(manualText);
    });
  });
});
