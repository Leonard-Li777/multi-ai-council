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
  sendToBackground,
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
import { Layers, ShieldCheck, Sparkles, AlertCircle, FastForward, History, RotateCcw } from 'lucide-react';

export const App: React.FC = () => {
  const [activeJob, setActiveJob] = useState<ReviewJob | null>(null);
  const [promptText, setPromptText] = useState<string>('');
  const [selectedSites, setSelectedSites] = useState<SupportedSite[]>(['DeepSeek']);
  const [lastPrompt, setLastPrompt] = useState<string>('');
  const [activeConvUrl, setActiveConvUrl] = useState<string>('');
  const [manualOverride, setManualOverride] = useState<boolean | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'prompt' | 'replies' | 'synthesis' | 'settings'>('prompt');

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

    // 建立带心跳的 Port 连接与 runtime.onMessage 双通道监听
    const handleJobSync = (job: ReviewJob) => {
      setActiveJob(job);
      const ref = job.providerRuns['DeepSeek']?.conversationRef;
      if (ref?.conversationUrl) {
        setActiveConvUrl(ref.conversationUrl);
      }
    };

    const { port, send } = setupPortWithHeartbeat(SIDEPANEL_PORT_NAME, (msg: PortMessage) => {
      if (msg.type === 'JOB_SYNC') {
        handleJobSync(msg.payload.job);
      }
    });

    portSendRef.current = send;

    const runtimeMsgListener = (msg: PortMessage) => {
      if (msg.type === 'JOB_SYNC') {
        handleJobSync(msg.payload.job);
      }
    };
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener(runtimeMsgListener);
    }

    return () => {
      try {
        port.disconnect();
      } catch {
        // ignore disconnect on unmounted
      }
      if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
        chrome.runtime.onMessage.removeListener(runtimeMsgListener);
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
        status: 'OPENING_TAB',
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
    setActiveTab('replies');
    await saveActiveJob(newJob);

    if (portSendRef.current) {
      portSendRef.current({ type: 'START_JOB', payload: { job: newJob } });
    } else {
      await sendToBackground({ type: 'START_JOB', payload: { job: newJob } });
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
    setActiveTab('prompt');
  };

  // 聚焦标签页（若不存在则自动创建）
  const handleFocusTab = (siteName: SupportedSite) => {
    if (portSendRef.current) {
      portSendRef.current({ type: 'FOCUS_TAB', payload: { siteName } });
    }
    sendToBackground({ type: 'FOCUS_TAB', payload: { siteName } });
  };

  // 一键打开所有勾选站点窗口（方便用户预先登录）
  const handleOpenAllSites = (sitesToOpen = selectedSites) => {
    if (portSendRef.current) {
      portSendRef.current({ type: 'OPEN_SITES', payload: { sites: sitesToOpen } });
    }
    sendToBackground({ type: 'OPEN_SITES', payload: { sites: sitesToOpen } });
  };

  // 重试单站（例如登录完成后重新提交）
  const handleRetry = (siteName: SupportedSite) => {
    if (portSendRef.current) {
      portSendRef.current({ type: 'RETRY_SITE', payload: { siteName } });
    }
    sendToBackground({ type: 'RETRY_SITE', payload: { siteName } });
  };

  // 跳过单个站点
  const handleSkipSite = (siteName: SupportedSite) => {
    if (portSendRef.current) {
      portSendRef.current({ type: 'SKIP_SITE', payload: { siteName, jobId: activeJob?.id } });
    }
    sendToBackground({ type: 'SKIP_SITE', payload: { siteName, jobId: activeJob?.id } });
  };

  // Quorum 快速降级终审
  const handleFastForward = () => {
    if (activeJob) {
      if (portSendRef.current) {
        portSendRef.current({ type: 'FAST_FORWARD_QUORUM', payload: { jobId: activeJob.id } });
      }
      sendToBackground({ type: 'FAST_FORWARD_QUORUM', payload: { jobId: activeJob.id } });
    }
  };

  // 延长生成超时时间 (+90s)
  const handleExtendTimeout = async () => {
    if (!activeJob) return;
    const newDeadline = Date.now() + 90000;
    const updated = { ...activeJob, deadlineAt: newDeadline };
    setActiveJob(updated);
    await saveActiveJob(updated);
    if (portSendRef.current) {
      portSendRef.current({ type: 'EXTEND_TIMEOUT', payload: { jobId: activeJob.id, extraSeconds: 90 } });
    }
    await sendToBackground({ type: 'EXTEND_TIMEOUT', payload: { jobId: activeJob.id, extraSeconds: 90 } });
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

  const hasBlockedLogin = useMemo(() => {
    if (!activeJob) return false;
    return Object.values(activeJob.providerRuns).some(
      (run) => run.status === 'BLOCKED_LOGIN' || run.status === 'BLOCKED_CAPTCHA'
    );
  }, [activeJob]);

  const isSynthesisRunning =
    activeJob?.synthesisRun?.status === 'OPENING_TAB' ||
    activeJob?.synthesisRun?.status === 'WAITING_READY' ||
    activeJob?.synthesisRun?.status === 'SENDING' ||
    activeJob?.synthesisRun?.status === 'STREAMING';

  const isRunning =
    activeJob !== null &&
    activeJob.active &&
    (!quorumProgress?.isAllSettled || isSynthesisRunning);

  // 选择并重载历史任务
  const handleSelectHistoryJob = async (job: ReviewJob) => {
    setActiveJob(job);
    setPromptText(job.originalPrompt);
    await saveActiveJob(job);
  };

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden p-3 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-100 text-xs box-border">
      {/* 顶部固定区域：标题栏 + 超时警报 + 站点状态/开关紧凑集中 */}
      <div className="shrink-0 flex flex-col">
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-200 dark:border-slate-800">
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

        {/* 90秒超时提示与快速降级/延长等待栏 */}
        {isTimedOut && quorumProgress && !quorumProgress.isAllSettled && (
          <div className="bg-amber-50 dark:bg-amber-950/80 border border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200 p-2 rounded-xl mb-2 flex items-center justify-between text-xs gap-2 shrink-0">
            <div className="flex items-center gap-1.5 min-w-0">
              <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
              <div className="min-w-0">
                <div className="font-semibold truncate">
                  {hasBlockedLogin
                    ? '等待登录中：请在对应站点窗口中完成登录'
                    : `已达超时时间（90秒）。已就绪 ${quorumProgress.completedCount} 站。`}
                </div>
                <div className="text-[10px] text-amber-700/90 dark:text-amber-300/90 truncate">
                  登录后点击卡片【已登录重试】或点击右侧【+90秒】
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={handleExtendTimeout}
                className="px-2 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-[10px] font-semibold transition-colors cursor-pointer flex items-center gap-1 shadow-2xs"
                title="延长 90 秒等待时间"
              >
                <RotateCcw className="w-3 h-3" />
                +90秒
              </button>
              {quorumProgress.completedCount > 0 && (
                <button
                  onClick={handleFastForward}
                  className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[10px] font-semibold transition-colors cursor-pointer flex items-center gap-1 shadow-2xs"
                >
                  <FastForward className="w-3 h-3" />
                  终审
                </button>
              )}
            </div>
          </div>
        )}

        {/* 四大一级功能 Tab 导航栏 */}
        <div className="flex items-center gap-1 bg-slate-200/60 dark:bg-slate-800/80 p-0.5 rounded-xl text-xs mb-1.5">
          <button
            type="button"
            onClick={() => setActiveTab('prompt')}
            className={`flex-1 py-1.5 px-2 rounded-lg font-medium transition-all text-center flex items-center justify-center gap-1 cursor-pointer ${
              activeTab === 'prompt'
                ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-2xs font-semibold'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <span>📝 会话提问</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('replies')}
            className={`flex-1 py-1.5 px-2 rounded-lg font-medium transition-all text-center flex items-center justify-center gap-1 cursor-pointer ${
              activeTab === 'replies'
                ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-2xs font-semibold'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <span>🤖 AI回复</span>
            {quorumProgress && (
              <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 font-mono">
                {quorumProgress.completedCount}/{quorumProgress.totalEnabled}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('synthesis')}
            className={`flex-1 py-1.5 px-2 rounded-lg font-medium transition-all text-center flex items-center justify-center gap-1 cursor-pointer ${
              activeTab === 'synthesis'
                ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-2xs font-semibold'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <span>⚖️ 终审看板</span>
            {activeJob?.synthesisRun?.status === 'STREAMING' && (
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
            )}
            {activeJob?.synthesisRun?.status === 'DONE' && (
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('settings')}
            className={`flex-1 py-1.5 px-2 rounded-lg font-medium transition-all text-center flex items-center justify-center gap-1 cursor-pointer ${
              activeTab === 'settings'
                ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-2xs font-semibold'
                : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <span>⚙️ 设置</span>
          </button>
        </div>
      </div>

      {/* 中间核心内容区域：根据当前 Tab 占满垂直空间，内部独立滚动 */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {/* Tab 1: 会话提问 */}
        {activeTab === 'prompt' && (
          <div className="flex-1 min-h-0 flex flex-col">
            <div className="flex-1 min-h-0">
              <PromptInput
                value={promptText}
                onChange={setPromptText}
                lastPrompt={lastPrompt}
                activeConversationUrl={activeConvUrl}
                manualOverride={manualOverride}
                onToggleOverride={handleToggleOverride}
                disabled={isRunning}
              />
            </div>
            <div className="shrink-0 pt-2">
              <JobControls
                onStart={handleStart}
                onClear={handleClear}
                isRunning={isRunning}
                canStart={promptText.trim().length > 0}
                canFastForward={quorumProgress?.canFastForward || false}
                onFastForward={handleFastForward}
                fastForwardTooltip={
                  quorumProgress?.canFastForward
                    ? `已就绪 ${quorumProgress.completedCount}/${quorumProgress.totalEnabled} 站点（满足 Quorum ${quorumProgress.minRequired}），点击跳过剩余站点发起终审`
                    : `Quorum 降级门槛：至少完成 ${quorumProgress?.minRequired || 1} 站点`
                }
              />
            </div>
          </div>
        )}

        {/* Tab 2: AI回复（多模型回复详情与一键复制） */}
        {activeTab === 'replies' && (
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            {/* 状态通知条与快捷控制 */}
            {activeJob && (
              <div className="shrink-0 mb-2 flex items-center justify-between bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-2.5 py-1.5 rounded-xl shadow-2xs">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-xs">
                    进度：{quorumProgress ? `${quorumProgress.completedCount}/${quorumProgress.totalEnabled} 站完成` : '就绪'}
                  </span>
                  {quorumProgress && (
                    <span className="text-[10px] text-slate-400">
                      (门槛: {quorumProgress.minRequired})
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    onClick={handleExtendTimeout}
                    className="px-2 py-1 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-[10px] font-semibold transition-colors cursor-pointer flex items-center gap-1 shadow-2xs"
                    title="延长 90 秒等待时间"
                  >
                    <RotateCcw className="w-3 h-3" />
                    +90秒
                  </button>
                  {quorumProgress && quorumProgress.completedCount > 0 && (
                    <button
                      onClick={() => {
                        handleFastForward();
                        setActiveTab('synthesis');
                      }}
                      className="px-2 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[10px] font-semibold transition-colors cursor-pointer flex items-center gap-1 shadow-2xs"
                      title="立即汇总各方观点进入终审看板"
                    >
                      <FastForward className="w-3 h-3" />
                      去终审
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* 站点卡片列表 */}
            {activeJob ? (
              <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
                {selectedSites.map((site) => (
                  <SiteStatusCard
                    key={site}
                    siteName={site}
                    run={activeJob.providerRuns[site]}
                    onFocusTab={() => handleFocusTab(site)}
                    onRetry={() => handleRetry(site)}
                    onSkip={() => handleSkipSite(site)}
                  />
                ))}
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-slate-400 text-center p-4">
                <p className="text-sm font-medium mb-1">暂无进行中的会话回复</p>
                <p className="text-xs text-slate-400 mb-3">
                  请前往【📝 会话提问】输入提示词并开始提问
                </p>
                <button
                  type="button"
                  onClick={() => setActiveTab('prompt')}
                  className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-semibold cursor-pointer shadow-2xs transition-colors"
                >
                  前往提问
                </button>
              </div>
            )}
          </div>
        )}

        {/* Tab 3: 终审看板（DeepSeek 全景汇总窗口） */}
        {activeTab === 'synthesis' && (
          <div className="flex-1 min-h-0 overflow-y-auto pr-1">
            <SynthesisCard
              synthesisRun={activeJob?.synthesisRun}
              activeJob={activeJob}
              onFocusSynthesisTab={() => handleFocusTab('DeepSeek')}
              onTriggerSynthesis={handleFastForward}
              canTriggerSynthesis={(quorumProgress?.completedCount || 0) > 0}
            />
          </div>
        )}

        {/* Tab 4: 设置（勾选启用的 AI 站点 & 系统控制） */}
        {activeTab === 'settings' && (
          <div className="flex-1 min-h-0 overflow-y-auto pr-1 space-y-3">
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 shadow-2xs">
              <div className="mb-2">
                <h3 className="font-semibold text-xs text-slate-800 dark:text-slate-200">
                  AI 站点启用配置
                </h3>
                <p className="text-[11px] text-slate-400">
                  勾选需要参与会话提问与终审对比的模型站点（至少勾选 1 个）
                </p>
              </div>

              <SiteChecklist
                selectedSites={selectedSites}
                onChange={handleSitesChange}
                onOpenSite={handleFocusTab}
                onOpenAllSites={() => handleOpenAllSites(selectedSites)}
                runs={activeJob?.providerRuns}
                disabled={isRunning}
              />
            </div>

            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-3 shadow-2xs">
              <h3 className="font-semibold text-xs text-slate-800 dark:text-slate-200 mb-1">
                会话与缓存管理
              </h3>
              <p className="text-[11px] text-slate-400 mb-2">
                清空当前活动任务及已保存的会话远程链接引用
              </p>
              <button
                type="button"
                onClick={handleClear}
                className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/60 dark:hover:bg-rose-900/60 text-rose-700 dark:text-rose-300 rounded-lg text-xs font-medium border border-rose-200 dark:border-rose-900 transition-colors cursor-pointer"
              >
                清空当前任务并重置会话
              </button>
            </div>
          </div>
        )}
      </div>

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
