import React, { useMemo } from 'react';
import { detectContinuation } from '../lib/utils/continuation-detector';
import { GitBranch, PlusCircle, RefreshCw, Link as LinkIcon, MessageSquare } from 'lucide-react';

interface PromptInputProps {
  value: string;
  onChange: (text: string) => void;
  lastPrompt: string;
  activeConversationUrl?: string;
  manualOverride: boolean | null; // null 表示使用自动判定，true 表示人工强制延续，false 表示人工强制新建
  onToggleOverride: () => void;
  disabled?: boolean;
}

export const PromptInput: React.FC<PromptInputProps> = ({
  value,
  onChange,
  lastPrompt,
  activeConversationUrl,
  manualOverride,
  onToggleOverride,
  disabled = false,
}) => {
  // 实时自动判定
  const autoDetection = useMemo(() => {
    return detectContinuation(value, lastPrompt);
  }, [value, lastPrompt]);

  // 最终判决：优先人工指定，其次自动算法；若输入为空且存在活跃会话，默认倾向延续绑定
  const isContinuation =
    manualOverride !== null
      ? manualOverride
      : value.trim().length === 0 && (!!activeConversationUrl || !!lastPrompt)
      ? true
      : autoDetection.isContinuation;

  const isManuallyOverridden = manualOverride !== null;

  return (
    <div className="flex-1 min-h-0 flex flex-col bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs overflow-hidden">
      {/* 延伸判定徽标与一键纠正栏 */}
      <div className="shrink-0 flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5 flex-wrap">
          {isContinuation ? (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800">
              <GitBranch className="w-3 h-3" />
              延续已有会话
              {isManuallyOverridden ? ' (人工锁定)' : autoDetection.reason === 'RULE_GRAVITY' ? ' (规则命中)' : ''}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800">
              <PlusCircle className="w-3 h-3" />
              开启新会话
              {isManuallyOverridden ? ' (人工锁定)' : ''}
            </span>
          )}
        </div>

        {/* 1 秒内一键切换按钮 */}
        <button
          type="button"
          onClick={onToggleOverride}
          disabled={disabled}
          className="text-[11px] font-medium text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 flex items-center gap-1 transition-colors px-2 py-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
        >
          <RefreshCw className="w-3 h-3" />
          {isContinuation ? '切换为新建' : '切换为延续'}
        </button>
      </div>

      {/* 会话映射简要状态条 */}
      {(activeConversationUrl || lastPrompt) && (
        <div className="shrink-0 text-[11px] bg-slate-50 dark:bg-slate-800/60 px-2.5 py-1.5 rounded-lg mb-2 text-slate-500 border border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 truncate min-w-0">
            {lastPrompt ? (
              <>
                <MessageSquare className="w-3 h-3 shrink-0 text-slate-400" />
                <span className="truncate">上轮: <span className="text-slate-700 dark:text-slate-300 font-medium">"{lastPrompt}"</span></span>
              </>
            ) : (
              <>
                <LinkIcon className="w-2.5 h-2.5 shrink-0 text-slate-400" />
                <span className="truncate">{activeConversationUrl}</span>
              </>
            )}
          </div>
          <span className={`shrink-0 text-[10px] font-medium ${isContinuation ? 'text-emerald-600 dark:text-emerald-400' : 'text-blue-600 dark:text-blue-400'}`}>
            {isContinuation ? '● 发往既有会话' : '○ 开独立新窗口'}
          </span>
        </div>
      )}

      {/* 文本输入框容器：充满剩余垂直高度，仅内部可滚动 */}
      <div className="flex-1 min-h-0 relative flex flex-col">
        <textarea
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          placeholder="请输入需要多模型协同审核或提问的提示词...&#10;&#10;输入框将自适应填满剩余空间，仅此处支持滚屏浏览。"
          className="w-full flex-1 min-h-0 p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 text-slate-800 dark:text-slate-100 focus:outline-hidden focus:ring-2 focus:ring-blue-500 focus:bg-white dark:focus:bg-slate-900 transition-all resize-none overflow-y-auto text-xs leading-relaxed"
        />
      </div>

      <div className="shrink-0 flex items-center justify-between pt-1.5 text-[11px] text-slate-400">
        <span>支持回车换行，自动保存</span>
        <span>{value.length} 字符</span>
      </div>
    </div>
  );
};
