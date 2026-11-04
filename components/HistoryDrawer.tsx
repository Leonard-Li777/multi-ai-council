import React, { useState, useEffect } from 'react';
import type { ReviewJob } from '../lib/types/review-job';
import {
  getJobHistory,
  clearAllHistory,
  deleteJob,
} from '../lib/storage/job-store';
import {
  History,
  X,
  Trash2,
  Calendar,
  Sparkles,
  Bot,
  CheckCircle2,
  AlertCircle,
  FileText,
} from 'lucide-react';

interface HistoryDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectJob: (job: ReviewJob) => void;
  currentJobId?: string;
}

export const HistoryDrawer: React.FC<HistoryDrawerProps> = ({
  isOpen,
  onClose,
  onSelectJob,
  currentJobId,
}) => {
  const [historyList, setHistoryList] = useState<ReviewJob[]>([]);
  const [loading, setLoading] = useState(false);

  const loadHistory = async () => {
    setLoading(true);
    try {
      const list = await getJobHistory(30);
      setHistoryList(list);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      loadHistory();
    }
  }, [isOpen]);

  const handleClearAll = async () => {
    if (!window.confirm('确定要清空所有历史协同记录吗？此操作无法撤销。')) return;
    await clearAllHistory();
    setHistoryList([]);
  };

  const handleDeleteOne = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await deleteJob(id);
    setHistoryList((prev) => prev.filter((j) => j.id !== id));
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex bg-slate-900/60 backdrop-blur-xs transition-opacity animate-in fade-in">
      <div className="w-full max-w-xs ml-auto bg-white dark:bg-slate-900 h-full flex flex-col shadow-2xl border-l border-slate-200 dark:border-slate-800">
        {/* 抽屉顶部栏 */}
        <div className="flex items-center justify-between p-3.5 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <History className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <h2 className="font-bold text-xs">历史协同审查任务</h2>
            <span className="text-[10px] text-slate-400">({historyList.length})</span>
          </div>
          <div className="flex items-center gap-1">
            {historyList.length > 0 && (
              <button
                onClick={handleClearAll}
                className="p-1 text-slate-400 hover:text-rose-500 rounded transition-colors"
                title="清空全部历史记录"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* 历史任务列表 */}
        <div className="flex-1 overflow-y-auto p-2.5 space-y-2">
          {loading ? (
            <div className="text-center py-10 text-slate-400 text-xs">加载历史任务中...</div>
          ) : historyList.length === 0 ? (
            <div className="text-center py-12 text-slate-400 text-xs">
              <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <span>暂无历史任务记录</span>
            </div>
          ) : (
            historyList.map((job) => {
              const isCurrent = job.id === currentJobId;
              const dateStr = new Date(job.createdAt).toLocaleString(undefined, {
                month: 'numeric',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              });
              const completedCount = Object.values(job.providerRuns).filter(
                (r) => r.status === 'DONE' || r.status === 'PARTIAL'
              ).length;
              const totalSites = Object.keys(job.providerRuns).length;

              return (
                <div
                  key={job.id}
                  onClick={() => {
                    onSelectJob(job);
                    onClose();
                  }}
                  className={`p-2.5 rounded-xl border text-xs cursor-pointer transition-all ${
                    isCurrent
                      ? 'bg-blue-50/80 dark:bg-blue-950/50 border-blue-300 dark:border-blue-700 shadow-2xs'
                      : 'bg-white/80 dark:bg-slate-900/80 border-slate-200 dark:border-slate-800 hover:border-blue-200 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                  }`}
                >
                  <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3" />
                      {dateStr}
                    </span>
                    <button
                      onClick={(e) => handleDeleteOne(e, job.id)}
                      className="text-slate-300 hover:text-rose-500 p-0.5 rounded transition-colors"
                      title="删除此记录"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>

                  <p className="line-clamp-2 text-slate-800 dark:text-slate-200 font-medium mb-1.5 leading-snug">
                    {job.originalPrompt}
                  </p>

                  <div className="flex items-center justify-between text-[10px]">
                    <span className="flex items-center gap-1 text-slate-500">
                      <Bot className="w-3 h-3" />
                      {completedCount}/{totalSites} 站完成
                    </span>

                    {job.synthesisRun?.status === 'DONE' ? (
                      <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium">
                        <Sparkles className="w-3 h-3 text-emerald-500" />
                        已终审
                      </span>
                    ) : (
                      <span className="text-slate-400">未终审</span>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
