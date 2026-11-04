import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type {
  ReviewJob,
  ProviderRun,
  SupportedSite,
  ProviderConversationRef,
  SynthesisRun,
} from '../types/review-job';

interface MultiAIDB extends DBSchema {
  jobs: {
    key: string;
    value: ReviewJob;
    indexes: { 'by-date': number; 'by-active': number };
  };
  conversation_refs: {
    key: string;
    value: ProviderConversationRef;
  };
}

const DB_NAME = 'multi-ai-council-db';
const DB_VERSION = 2;
const SESSION_ACTIVE_JOB_KEY = 'multi_ai_active_job';
const SESSION_CONV_REFS_KEY = 'multi_ai_conversation_refs';

let dbPromise: Promise<IDBPDatabase<MultiAIDB>> | null = null;

function getDB(): Promise<IDBPDatabase<MultiAIDB>> {
  if (!dbPromise) {
    dbPromise = openDB<MultiAIDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('jobs')) {
          const store = db.createObjectStore('jobs', { keyPath: 'id' });
          store.createIndex('by-date', 'createdAt');
          store.createIndex('by-active', 'active');
        }
        if (!db.objectStoreNames.contains('conversation_refs')) {
          db.createObjectStore('conversation_refs', { keyPath: 'siteName' });
        }
      },
    });
  }
  return dbPromise;
}

/**
 * 将活跃 Job 同步存入 chrome.storage.session 与 IndexedDB
 */
export async function saveActiveJob(job: ReviewJob): Promise<void> {
  job.updatedAt = Date.now();

  // 1. 存入 session storage (若在支持的环境下)
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      await chrome.storage.session.set({ [SESSION_ACTIVE_JOB_KEY]: job });
    }
  } catch (err) {
    console.warn('[JobStore] Failed to write to chrome.storage.session', err);
  }

  // 2. 幂等落盘 IndexedDB
  try {
    const db = await getDB();
    await db.put('jobs', job);
  } catch (err) {
    console.error('[JobStore] Failed to write to IndexedDB', err);
  }
}

/**
 * 获取当前活跃 Job，优先从 session 读，若 SW 重启则从 IndexedDB 恢复
 */
export async function getActiveJob(): Promise<ReviewJob | null> {
  // 1. 尝试从 chrome.storage.session 恢复
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      const res = await chrome.storage.session.get(SESSION_ACTIVE_JOB_KEY);
      if (res && res[SESSION_ACTIVE_JOB_KEY]) {
        return res[SESSION_ACTIVE_JOB_KEY] as ReviewJob;
      }
    }
  } catch (err) {
    console.warn('[JobStore] Session read failed, fallback to IndexedDB', err);
  }

  // 2. 从 IndexedDB 恢复最新活跃状态的 Job
  try {
    const db = await getDB();
    const all = await db.getAllFromIndex('jobs', 'by-date');
    const active = all.reverse().find((j) => j.active);
    if (active) {
      // 恢复写回 session
      if (typeof chrome !== 'undefined' && chrome.storage?.session) {
        await chrome.storage.session.set({ [SESSION_ACTIVE_JOB_KEY]: active });
      }
      return active;
    }
  } catch (err) {
    console.error('[JobStore] Failed to read from IndexedDB', err);
  }

  return null;
}

/**
 * 局部幂等更新单个站点的 Run 状态
 */
export async function updateProviderRun(
  jobId: string,
  siteName: SupportedSite,
  update: Partial<ProviderRun>
): Promise<ReviewJob | null> {
  const job = await getActiveJob();
  if (!job || job.id !== jobId) {
    // 尝试从 IDB 读取指定 ID
    const db = await getDB();
    const storedJob = await db.get('jobs', jobId);
    if (!storedJob) return null;
    return updateRunInternal(storedJob, siteName, update);
  }
  return updateRunInternal(job, siteName, update);
}

async function updateRunInternal(
  job: ReviewJob,
  siteName: SupportedSite,
  update: Partial<ProviderRun>
): Promise<ReviewJob> {
  const currentRun = job.providerRuns[siteName] || {
    siteName,
    status: 'PENDING',
    responseSnapshot: '',
    cleanedResponse: '',
    retryCount: 0,
  };

  // 终态保护：一旦被 CANCELED 或 TAB_CLOSED，忽略后续迟到的流式 STREAMING / DONE 状态覆写
  const isTerminal = currentRun.status === 'CANCELED' || currentRun.status === 'TAB_CLOSED';
  const isReactivation =
    update.status === 'PENDING' || update.status === 'OPENING_TAB' || update.status === 'WAITING_READY';

  const newStatus = isTerminal && !isReactivation ? currentRun.status : (update.status ?? currentRun.status);

  job.providerRuns[siteName] = {
    ...currentRun,
    ...update,
    status: newStatus,
  };

  await saveActiveJob(job);
  return job;
}

/**
 * 批量原子更新多个站点的状态，避免循环顺序多次落盘
 */
export async function batchUpdateProviderRuns(
  jobId: string,
  updates: Partial<Record<SupportedSite, Partial<ProviderRun>>>
): Promise<ReviewJob | null> {
  const job = await getActiveJob();
  const targetJob = job && job.id === jobId ? job : await (await getDB()).get('jobs', jobId);
  if (!targetJob) return null;

  for (const [siteName, update] of Object.entries(updates) as [SupportedSite, Partial<ProviderRun>][]) {
    const currentRun = targetJob.providerRuns[siteName] || {
      siteName,
      status: 'PENDING',
      responseSnapshot: '',
      cleanedResponse: '',
      retryCount: 0,
    };

    const isTerminal = currentRun.status === 'CANCELED' || currentRun.status === 'TAB_CLOSED';
    const isReactivation =
      update.status === 'PENDING' || update.status === 'OPENING_TAB' || update.status === 'WAITING_READY';
    const newStatus = isTerminal && !isReactivation ? currentRun.status : (update.status ?? currentRun.status);

    targetJob.providerRuns[siteName] = {
      ...currentRun,
      ...update,
      status: newStatus,
    };
  }

  await saveActiveJob(targetJob);
  return targetJob;
}

/**
 * 清除当前活跃 Job
 */
export async function clearActiveJob(): Promise<void> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      await chrome.storage.session.remove(SESSION_ACTIVE_JOB_KEY);
    }
  } catch (err) {
    console.warn('[JobStore] Failed to clear session storage', err);
  }

  try {
    const db = await getDB();
    const all = await db.getAll('jobs');
    const tx = db.transaction('jobs', 'readwrite');
    for (const j of all) {
      if (j.active) {
        j.active = false;
        await tx.store.put(j);
      }
    }
    await tx.done;
  } catch (err) {
    console.error('[JobStore] Failed to mark inactive in IndexedDB', err);
  }
}

/**
 * 查询历史任务
 */
export async function getJobHistory(limit = 20): Promise<ReviewJob[]> {
  try {
    const db = await getDB();
    const list = await db.getAllFromIndex('jobs', 'by-date');
    return list.reverse().slice(0, limit);
  } catch (err) {
    console.error('[JobStore] Failed to fetch history', err);
    return [];
  }
}

/**
 * 保存指定站点的活跃会话映射（同时双写 session 与 IndexedDB）
 */
export async function saveConversationRef(ref: ProviderConversationRef): Promise<void> {
  // 1. Session Storage
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      const existing = await chrome.storage.session.get(SESSION_CONV_REFS_KEY);
      const refs: Record<string, ProviderConversationRef> =
        (existing && (existing[SESSION_CONV_REFS_KEY] as Record<string, ProviderConversationRef>)) || {};
      refs[ref.siteName] = ref;
      await chrome.storage.session.set({ [SESSION_CONV_REFS_KEY]: refs });
    }
  } catch (err) {
    console.warn('[JobStore] Failed to save conversation ref to session', err);
  }

  // 2. IndexedDB 落盘
  try {
    const db = await getDB();
    await db.put('conversation_refs', ref);
  } catch (err) {
    console.warn('[JobStore] Failed to persist conversation ref to IndexedDB', err);
  }
}

/**
 * 获取指定站点的活跃会话引用（优先 session，冷启动从 IndexedDB 恢复，杜绝历史僵尸回溯）
 */
export async function getConversationRef(siteName: SupportedSite): Promise<ProviderConversationRef | null> {
  // 1. 尝试从 Session Storage 获取
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      const existing = await chrome.storage.session.get(SESSION_CONV_REFS_KEY);
      const refs = existing && (existing[SESSION_CONV_REFS_KEY] as Record<string, ProviderConversationRef> | undefined);
      if (refs && refs[siteName]) {
        return refs[siteName] as ProviderConversationRef;
      }
    }
  } catch (err) {
    console.warn('[JobStore] Failed to read conversation ref from session', err);
  }

  // 2. 尝试从 IndexedDB 恢复
  try {
    const db = await getDB();
    const stored = await db.get('conversation_refs', siteName);
    if (stored) {
      return stored;
    }
  } catch (err) {
    console.warn('[JobStore] Failed to read conversation ref from IndexedDB', err);
  }

  return null;
}

/**
 * 清除所有站点的活跃会话映射（同步清理 session 与 IndexedDB）
 */
export async function clearAllConversationRefs(): Promise<void> {
  try {
    if (typeof chrome !== 'undefined' && chrome.storage?.session) {
      await chrome.storage.session.remove(SESSION_CONV_REFS_KEY);
    }
  } catch (err) {
    console.warn('[JobStore] Failed to clear conversation refs from session', err);
  }

  try {
    const db = await getDB();
    await db.clear('conversation_refs');
  } catch (err) {
    console.warn('[JobStore] Failed to clear conversation refs from IndexedDB', err);
  }
}

/**
 * 更新终审聚合任务状态 (SynthesisRun)
 */
export async function updateSynthesisRun(
  jobId: string,
  updates: Partial<SynthesisRun>
): Promise<ReviewJob | null> {
  const current = await getActiveJob();
  if (!current || current.id !== jobId) return null;

  const currentSynthesis: SynthesisRun = current.synthesisRun || {
    status: 'PENDING',
    anonymousMap: {},
    finalMarkdown: '',
  };

  const updatedSynthesis: SynthesisRun = {
    ...currentSynthesis,
    ...updates,
  };

  current.synthesisRun = updatedSynthesis;
  await saveActiveJob(current);
  return current;
}
