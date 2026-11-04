import { describe, it, expect } from 'vitest';
import { calculateQuorumProgress, isJobTimedOut } from '../lib/utils/quorum-calculator';
import type { ReviewJob, ProviderRun } from '../lib/types/review-job';

describe('Quorum & Fallback Calculator', () => {
  const baseJob: ReviewJob = {
    id: 'test-job-quorum',
    originalPrompt: '测试 Quorum 判定',
    isContinuation: false,
    createdAt: 1000,
    updatedAt: 1000,
    deadlineAt: 91000, // 90s 后超时
    aggregationPolicy: {
      minCompletedProviders: 2,
      allowPartialAggregation: true,
      judgeProvider: 'DeepSeek',
      enabledSites: ['DeepSeek', 'ChatGPT', 'Claude'],
    },
    providerRuns: {},
    active: true,
  };

  it('should correctly assess initial in-progress state', () => {
    const job: ReviewJob = {
      ...baseJob,
      providerRuns: {
        DeepSeek: { siteName: 'DeepSeek', status: 'STREAMING', responseSnapshot: '', cleanedResponse: '', retryCount: 0 },
        ChatGPT: { siteName: 'ChatGPT', status: 'WAITING_READY', responseSnapshot: '', cleanedResponse: '', retryCount: 0 },
        Claude: { siteName: 'Claude', status: 'OPENING_TAB', responseSnapshot: '', cleanedResponse: '', retryCount: 0 },
      },
    };

    const progress = calculateQuorumProgress(job);
    expect(progress.completedCount).toBe(0);
    expect(progress.inProgressCount).toBe(3);
    expect(progress.isQuorumReached).toBe(false);
    expect(progress.canFastForward).toBe(false);
    expect(progress.isAllSettled).toBe(false);
  });

  it('should detect Quorum reached and enable FastForward when min providers are completed', () => {
    const job: ReviewJob = {
      ...baseJob,
      providerRuns: {
        DeepSeek: { siteName: 'DeepSeek', status: 'DONE', responseSnapshot: 'ok', cleanedResponse: 'ok', retryCount: 0 },
        ChatGPT: { siteName: 'ChatGPT', status: 'DONE', responseSnapshot: 'ok', cleanedResponse: 'ok', retryCount: 0 },
        Claude: { siteName: 'Claude', status: 'STREAMING', responseSnapshot: '...', cleanedResponse: '...', retryCount: 0 },
      },
    };

    const progress = calculateQuorumProgress(job);
    expect(progress.completedCount).toBe(2);
    expect(progress.inProgressCount).toBe(1);
    expect(progress.isQuorumReached).toBe(true);
    expect(progress.canFastForward).toBe(true); // Claude 还在生成，但已达 Quorum 2，允许 FastForward!
    expect(progress.isAllSettled).toBe(false);
  });

  it('should correctly evaluate state when a stuck provider is skipped/canceled', () => {
    const job: ReviewJob = {
      ...baseJob,
      providerRuns: {
        DeepSeek: { siteName: 'DeepSeek', status: 'DONE', responseSnapshot: 'ok', cleanedResponse: 'ok', retryCount: 0 },
        ChatGPT: { siteName: 'ChatGPT', status: 'DONE', responseSnapshot: 'ok', cleanedResponse: 'ok', retryCount: 0 },
        Claude: { siteName: 'Claude', status: 'CANCELED', responseSnapshot: '', cleanedResponse: '', errorReason: '用户跳过', retryCount: 0 },
      },
    };

    const progress = calculateQuorumProgress(job);
    expect(progress.completedCount).toBe(2);
    expect(progress.inProgressCount).toBe(0);
    expect(progress.isQuorumReached).toBe(true);
    expect(progress.canFastForward).toBe(false); // 所有站点已结算，无需再手动降级
    expect(progress.isAllSettled).toBe(true);
  });

  it('should calculate job timeout accurately based on deadlineAt', () => {
    expect(isJobTimedOut(baseJob, 50000)).toBe(false);
    expect(isJobTimedOut(baseJob, 91000)).toBe(true);
    expect(isJobTimedOut(baseJob, 100000)).toBe(true);
  });
});
