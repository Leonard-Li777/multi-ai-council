import React from 'react';
import { Play, Trash2, FastForward, Loader2 } from 'lucide-react';

interface JobControlsProps {
  onStart: () => void;
  onClear: () => void;
  isRunning: boolean;
  canStart: boolean;
}

export const JobControls: React.FC<JobControlsProps> = ({
  onStart,
  onClear,
  isRunning,
  canStart,
}) => {
  return (
    <div className="flex items-center gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
      <button
        type="button"
        disabled={!canStart || isRunning}
        onClick={onStart}
        className={`flex-1 flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl text-xs font-semibold shadow-xs transition-all ${
          canStart && !isRunning
            ? 'bg-blue-600 hover:bg-blue-700 text-white cursor-pointer active:scale-[0.98]'
            : 'bg-slate-200 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
        }`}
      >
        {isRunning ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            协同生成中...
          </>
        ) : (
          <>
            <Play className="w-4 h-4 fill-current" />
            开始多模型审核
          </>
        )}
      </button>

      {/* Quorum 降级占位按钮（第1步明确占位） */}
      <button
        type="button"
        disabled
        title="Quorum 快速降级（第4步聚合接入）"
        className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-300 dark:text-slate-600 cursor-not-allowed"
      >
        <FastForward className="w-4 h-4" />
      </button>

      <button
        type="button"
        onClick={onClear}
        title="清空当前任务状态与快照"
        className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors"
      >
        <Trash2 className="w-4 h-4" />
      </button>
    </div>
  );
};
