import React, { useState, useEffect, useRef, useMemo } from 'react';
import type { ReviewJob, SupportedSite, ProviderRun } from '../../lib/types/review-job';
import {
  getActiveJob,
  saveActiveJob,
  clearActiveJob,
  getJobHistory,
  getConversationRef,
  clearAllConversationRefs,
} from '../../lib/storage/job-store';
import {
  SIDEPANEL_PORT_NAME,
  setupPortWithHeartbeat,
  type PortMessage,
} from '../../lib/messaging/port';
import { SiteChecklist } from '../../components/SiteChecklist';
import { PromptInput } from '../../components/PromptInput';
import { SiteStatusCard } from '../../components/SiteStatusCard';
import { SynthesisCard } from '../../components/SynthesisCard';
import { JobControls } from '../../components/JobControls';
import { HistoryDrawer } from '../../components/HistoryDrawer';
import { detectContinuation } from '../../lib/utils/continuation-detector';
import {
  calculateQuorumProgress,
  calculateDefaultMinQuorum,
  isJobTimedOut,
} from '../../lib/utils/quorum-calculator';
import { Layers, ShieldCheck, Sparkles, AlertCircle, FastForward, History } from 'lucide-react';

export const App: React.FC = () => {
  const [activeJob, setActiveJob] = useState<ReviewJob | null>(null);
  const [promptText, setPromptText] = useState<string>('');
  const [selectedSites, setSelectedSites] = useState<SupportedSite[]>(['DeepSeek']);
  const [lastPrompt, setLastPrompt] = useState<string>('');
  const [activeConvUrl, setActiveConvUrl] = useState<string>('');
  const [manualOverride, setManualOverride] = useState<boolean | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);

  const portSendRef = useRef<((msg: PortMessage) => void) | null>(null);

  // 1. 初始化恢复与端口连接
  useEffect(() => {
    async function init() {
      // 从持久化存储（session + IndexedDB）幂等恢复当前未完成任务
      const stored = await getActiveJob();
      if (stored && stored.active) {
        setActiveJob(stored);
        setPromptText(stored.originalPrompt);
      }

      // 提取最近一次历史提示词与绑定的会话引用供延伸判定
      const history = await getJobHistory(2);
      if (history.length > 0 && history[0]) {
        setLastPrompt(history[0].originalPrompt);
      }

      const ref = await getConversationRef('DeepSeek');
      if (ref?.conversationUrl) {
        setActiveConvUrl(ref.conversationUrl);
      }

      // 提取已配置的生效站点
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        chrome.storage.local.get('enabled_sites', (res) => {
          if (res?.enabled_sites && Array.isArray(res.enabled_sites) && res.enabled_sites.length > 0) {
            setSelectedSites(res.enabled_sites);
          }
        });
      }
    }
    init();

    // 建立带心跳的 Port 连接
    const { port, send } = setupPortWithHeartbeat(SIDEPANEL_PORT_NAME, (msg: PortMessage) => {
      if (msg.type === 'JOB_SYNC') {
        setActiveJob(msg.payload.job);
        const ref = msg.payload.job.providerRuns['DeepSeek']?.conversationRef;
        if (ref?.conversationUrl) {
          setActiveConvUrl(ref.conversationUrl);
        }
      }
    });

    portSendRef.current = send;

    return () => {
      try {
        port.disconnect();
      } catch {
        // ignore disconnect on unmounted
      }
    };
  }, []);

  // 切换手动覆盖
  const handleToggleOverride = () => {
    const auto = detectContinuation(promptText, lastPrompt).isContinuation;
    const current = manualOverride !== null ? manualOverride : auto;
    setManualOverride(!current);
  };

  // 切换站点生效状态并持久化
  const handleSitesChange = (sites: SupportedSite[]) => {
    setSelectedSites(sites);
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      chrome.storage.local.set({ enabled_sites: sites }).catch(() => {});
    }
  };

  // 启动任务
  const handleStart = async () => {
    if (!promptText.trim()) return;

    const auto = detectContinuation(promptText, lastPrompt).isContinuation;
    const isContinuation = manualOverride !== null ? manualOverride : auto;

    const initialRuns: Record<string, ProviderRun> = {};
    for (const site of selectedSites) {
      initialRuns[site] = {
        siteName: site,
        status: 'PENDING',
        responseSnapshot: '',
        cleanedResponse: '',
        retryCount: 0,
      };
    }

    const newJob: ReviewJob = {
      id: crypto.randomUUID(),
      originalPrompt: promptText.trim(),
      isContinuation,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      deadlineAt: Date.now() + 90000, // 90 秒超时保护
      aggregationPolicy: {
        minCompletedProviders: calculateDefaultMinQuorum(selectedSites.length),
        allowPartialAggregation: true,
        judgeProvider: 'DeepSeek',
        enabledSites: selectedSites,
      },
      providerRuns: initialRuns,
      active: true,
    };

    setActiveJob(newJob);
    await saveActiveJob(newJob);

    if (portSendRef.current) {
      portSendRef.current({ type: 'START_JOB', payload: { job: newJob } });
    }
  };

  // 清空任务与会话绑定
  const handleClear = async () => {
    await clearActiveJob();
    await clearAllConversationRefs();
    setActiveJob(null);
    setPromptText('');
    setLastPrompt('');
    setActiveConvUrl('');
    setManualOverride(null);
  };

  // 聚焦标签页
  const handleFocusTab = (siteName: SupportedSite) => {
    if (portSendRef.current) {
      portSendRef.current({ type: 'FOCUS_TAB', payload: { siteName } });
    }
  };

  // 重试单站
  const handleRetry = (siteName: SupportedSite) => {
    if (portSendRef.current) {
      portSendRef.current({ type: 'RETRY_SITE', payload: { siteName } });
    }
  };

  // 跳过单个站点
  const handleSkipSite = (siteName: SupportedSite) => {
    if (portSendRef.current) {
      portSendRef.current({ type: 'SKIP_SITE', payload: { siteName, jobId: activeJob?.id } });
    }
  };

  // Quorum 快速降级终审
  const handleFastForward = () => {
    if (portSendRef.current && activeJob) {
      portSendRef.current({ type: 'FAST_FORWARD_QUORUM', payload: { jobId: activeJob.id } });
    }
  };

  // 定期驱动时间刷新以触发 90s 超时检查（仅当任务激活时定时刷新）
  const [currentTime, setCurrentTime] = useState(Date.now());
  useEffect(() => {
    if (!activeJob || !activeJob.active) return;
    const timer = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [activeJob?.active]);

  const quorumProgress = useMemo(() => {
    if (!activeJob) return null;
    return calculateQuorumProgress(activeJob);
  }, [activeJob]);

  const isTimedOut = activeJob ? isJobTimedOut(activeJob, currentTime) : false;

  const isRunning =
    activeJob !== null &&
    (Object.values(activeJob.providerRuns).some(
      (run) =>
        run.status === 'OPENING_TAB' ||
        run.status === 'WAITING_READY' ||
        run.status === 'SENDING' ||
        run.status === 'STREAMING'
    ) ||
      activeJob.synthesisRun?.status === 'OPENING_TAB' ||
      activeJob.synthesisRun?.status === 'WAITING_READY' ||
      activeJob.synthesisRun?.status === 'SENDING' ||
      activeJob.synthesisRun?.status === 'STREAMING');

  // 选择并重载历史任务
  const handleSelectHistoryJob = async (job: ReviewJob) => {
    setActiveJob(job);
    setPromptText(job.originalPrompt);
    await saveActiveJob(job);
  };

  return (
    <div className="flex flex-col min-h-screen p-3.5 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 text-xs">
      {/* 顶部标题栏 */}
      <div className="flex items-center justify-between pb-3 mb-3 border-b border-slate-200 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-blue-600 flex items-center justify-center text-white shadow-xs">
            <Layers className="w-3.5 h-3.5" />
          </div>
          <div>
            <h1 className="font-bold text-xs leading-none">Multi-AI Council</h1>
            <span className="text-[10px] text-slate-400">
              Quorum: {quorumProgress ? `${quorumProgress.completedCount}/${quorumProgress.minRequired} 门槛` : '就绪'}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setIsHistoryOpen(true)}
            className="flex items-center gap-1 text-[11px] text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 bg-white dark:bg-slate-900 hover:bg-blue-50 dark:hover:bg-slate-800 px-2 py-0.5 rounded-lg border border-slate-200 dark:border-slate-800 transition-colors cursor-pointer shadow-2xs"
            title="查看历史任务与终审存档"
          >
            <History className="w-3 h-3 text-blue-500" />
            <span>历史</span>
          </button>

          <div className="flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-full font-medium border border-emerald-200/50 dark:border-emerald-800/50">
            <ShieldCheck className="w-3 h-3" />
            <span>本地双写</span>
          </div>
        </div>
      </div>

      {/* 90秒超时提示与快速降级栏 */}
      {isTimedOut && quorumProgress && !quorumProgress.isAllSettled && (
        <div className="bg-amber-50 dark:bg-amber-950/80 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 p-2.5 rounded-xl mb-3 flex items-center justify-between text-xs animate-pulse">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
            <span>已达超时时间（90秒）。已就绪 {quorumProgress.completedCount} 站。</span>
          </div>
          {quorumProgress.completedCount > 0 && (
            <button
              onClick={handleFastForward}
              className="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-[11px] font-semibold transition-colors cursor-pointer flex items-center gap-1 shadow-2xs"
            >
              <FastForward className="w-3 h-3" />
              立即降级终审
            </button>
          )}
        </div>
      )}

      {/* 站点选择与开启/关闭 */}
      <SiteChecklist
        selectedSites={selectedSites}
        onChange={handleSitesChange}
        disabled={isRunning}
      />

      {/* 提示词输入与延伸判定 */}
      <PromptInput
        value={promptText}
        onChange={setPromptText}
        lastPrompt={lastPrompt}
        activeConversationUrl={activeConvUrl}
        manualOverride={manualOverride}
        onToggleOverride={handleToggleOverride}
        disabled={isRunning}
      />

      {/* 终审综合聚合报告卡片 */}
      {activeJob?.synthesisRun && (
        <SynthesisCard
          synthesisRun={activeJob.synthesisRun}
          activeJob={activeJob}
        />
      )}

      {/* 任务状态卡片矩阵 */}
      <div className="flex-1 overflow-y-auto mb-3">
        <div className="flex items-center justify-between mb-1.5 px-0.5">
          <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider">
            实时执行状态
          </span>
          {activeJob && (
            <span className="text-[10px] text-slate-400 font-mono">
              Job: {activeJob.id.slice(0, 8)}
            </span>
          )}
        </div>

        {selectedSites.map((site) => (
          <SiteStatusCard
            key={site}
            siteName={site}
            run={activeJob?.providerRuns[site]}
            onFocusTab={() => handleFocusTab(site)}
            onRetry={() => handleRetry(site)}
            onSkip={() => handleSkipSite(site)}
          />
        ))}
      </div>

      {/* 底部控制区 */}
      <JobControls
        onStart={handleStart}
        onClear={handleClear}
        isRunning={isRunning}
        canStart={promptText.trim().length > 0}
        canFastForward={quorumProgress?.canFastForward || false}
        onFastForward={handleFastForward}
        fastForwardTooltip={
          quorumProgress?.canFastForward
            ? `已就绪 ${quorumProgress.completedCount}/${quorumProgress.totalEnabled} 站点（满足 Quorum ${quorumProgress.minRequired}），点击立即跳过剩余站点发起终审`
            : `Quorum 降级门槛：至少完成 ${quorumProgress?.minRequired || 1} 站点`
        }
      />
      {/* 历史任务抽屉 */}
      <HistoryDrawer
        isOpen={isHistoryOpen}
        onClose={() => setIsHistoryOpen(false)}
        onSelectJob={handleSelectHistoryJob}
        currentJobId={activeJob?.id}
      />
    </div>
  );
};

export default App;
