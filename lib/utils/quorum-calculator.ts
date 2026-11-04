import type { ReviewJob, ProviderStatus } from '../types/review-job';

export interface QuorumProgress {
  totalEnabled: number;
  completedCount: number;
  inProgressCount: number;
  failedOrCanceledCount: number;
  minRequired: number;
  isQuorumReached: boolean;
  canFastForward: boolean; // 已达 Quorum 且仍有站点正在生成，可一键降级
  isAllSettled: boolean;    // 所有站点均已终结（无需再降级）
}

const COMPLETED_STATUSES: Set<ProviderStatus> = new Set(['DONE', 'PARTIAL']);
const IN_PROGRESS_STATUSES: Set<ProviderStatus> = new Set([
  'PENDING',
  'OPENING_TAB',
  'WAITING_READY',
  'SENDING',
  'STREAMING',
]);

/**
 * 依据启用的站点总数计算默认的 Quorum 门槛（避免 <=3 站点时 FastForward 永远死锁）
 * 1站 -> 1
 * 2站 -> 1 (1站完成即可提前降级)
 * 3站 -> 2 (2站完成即可提前降级，容错1站)
 * 4站 -> 2
 * 5站 -> 3 (3站完成即可提前降级，容错2站)
 * 7站 -> 4
 */
export function calculateDefaultMinQuorum(totalSites: number): number {
  if (totalSites <= 1) return 1;
  if (totalSites === 2) return 1;
  return Math.max(1, Math.ceil(totalSites * 0.55));
}

/**
 * 计算当前任务的 Quorum 就绪进度与降级判定
 */
export function calculateQuorumProgress(job: ReviewJob): QuorumProgress {
  const enabledSites = job.aggregationPolicy.enabledSites;
  const totalEnabled = enabledSites.length;
  const minRequired = Math.min(job.aggregationPolicy.minCompletedProviders, totalEnabled);

  let completedCount = 0;
  let inProgressCount = 0;
  let failedOrCanceledCount = 0;

  for (const site of enabledSites) {
    const run = job.providerRuns[site];
    const status = run?.status || 'PENDING';

    if (COMPLETED_STATUSES.has(status)) {
      completedCount++;
    } else if (IN_PROGRESS_STATUSES.has(status)) {
      inProgressCount++;
    } else {
      failedOrCanceledCount++;
    }
  }

  const isQuorumReached = completedCount >= minRequired;
  const isAllSettled = inProgressCount === 0;
  const canFastForward = isQuorumReached && inProgressCount > 0;

  return {
    totalEnabled,
    completedCount,
    inProgressCount,
    failedOrCanceledCount,
    minRequired,
    isQuorumReached,
    canFastForward,
    isAllSettled,
  };
}

/**
 * 检查任务是否已超过设定的截止时间 (90s 默认)
 */
export function isJobTimedOut(job: ReviewJob, now = Date.now()): boolean {
  if (!job.deadlineAt) return false;
  return now >= job.deadlineAt;
}
