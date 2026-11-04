import React, { useState } from 'react';
import type { SynthesisRun, ProviderStatus } from '../lib/types/review-job';
import { Sparkles, Copy, Check, ChevronDown, ChevronUp, Bot, ExternalLink } from 'lucide-react';

interface SynthesisCardProps {
  synthesisRun?: SynthesisRun;
  onFocusSynthesisTab?: () => void;
}

export const SynthesisCard: React.FC<SynthesisCardProps> = ({
  synthesisRun,
  onFocusSynthesisTab,
}) => {
  const [copied, setCopied] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);

  if (!synthesisRun) return null;

  const handleCopy = async () => {
    if (!synthesisRun.finalMarkdown) return;
    try {
      await navigator.clipboard.writeText(synthesisRun.finalMarkdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.warn('Copy failed', e);
    }
  };

  const statusConfig: Record<ProviderStatus, { label: string; color: string }> = {
    PENDING: { label: '待终审', color: 'bg-slate-100 text-slate-600 border-slate-200' },
    OPENING_TAB: { label: '唤起窗口...', color: 'bg-blue-50 text-blue-600 border-blue-200 animate-pulse' },
    WAITING_READY: { label: '等待就绪', color: 'bg-amber-50 text-amber-600 border-amber-200 animate-pulse' },
    SENDING: { label: '注入沙箱中', color: 'bg-purple-50 text-purple-600 border-purple-200 animate-pulse' },
    STREAMING: { label: '终审提炼中', color: 'bg-emerald-50 text-emerald-600 border-emerald-200 animate-pulse' },
    DONE: { label: '终审已完成', color: 'bg-emerald-100 text-emerald-800 border-emerald-300 font-semibold' },
    TAB_CLOSED: { label: '窗口已关闭', color: 'bg-rose-50 text-rose-600 border-rose-200' },
    FAILED: { label: '终审失败', color: 'bg-rose-100 text-rose-800 border-rose-300' },
    BLOCKED_CAPTCHA: { label: '人机拦截', color: 'bg-amber-100 text-amber-800 border-amber-300' },
    BLOCKED_LOGIN: { label: '未登录', color: 'bg-amber-100 text-amber-800 border-amber-300' },
    RATE_LIMITED: { label: '频次限制', color: 'bg-amber-100 text-amber-800 border-amber-300' },
    CANCELED: { label: '已取消', color: 'bg-slate-100 text-slate-500 border-slate-200' },
    TIMEOUT: { label: '超时', color: 'bg-rose-50 text-rose-600 border-rose-200' },
    PARTIAL: { label: '部分完成', color: 'bg-amber-50 text-amber-600 border-amber-200' },
  };

  const currentCfg = statusConfig[synthesisRun.status] || statusConfig.PENDING;

  return (
    <div className="bg-linear-to-br from-indigo-50/70 via-white to-blue-50/70 dark:from-indigo-950/40 dark:via-slate-900 dark:to-blue-950/40 border border-indigo-200/80 dark:border-indigo-800/60 rounded-xl p-3 shadow-xs mb-3 transition-all">
      {/* 头部标题与状态栏 */}
      <div className="flex items-center justify-between pb-2 mb-2 border-b border-indigo-100 dark:border-indigo-900/60">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg bg-linear-to-tr from-indigo-600 to-purple-600 flex items-center justify-center text-white shadow-xs">
            <Sparkles className="w-3.5 h-3.5" />
          </div>
          <div>
            <div className="font-bold text-xs text-indigo-950 dark:text-indigo-200 flex items-center gap-1.5">
              <span>DeepSeek 终审聚合报告</span>
              {synthesisRun.status === 'STREAMING' && (
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping inline-block" />
              )}
            </div>
            <span className="text-[10px] text-slate-400">匿名盲审 · 四层重构 · 去伪存真</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${currentCfg.color}`}>
            {currentCfg.label}
          </span>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
          >
            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* 匿名打乱映射指示器（供用户追溯各 Model 真实对应） */}
      {Object.keys(synthesisRun.anonymousMap || {}).length > 0 && (
        <div className="mb-2.5 bg-white/80 dark:bg-slate-900/80 p-2 rounded-lg border border-indigo-100/60 dark:border-indigo-900/40 text-[10px]">
          <span className="text-slate-400 font-medium block mb-1">各模型匿名盲审对照：</span>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(synthesisRun.anonymousMap).map(([label, site]) => (
              <span
                key={label}
                className="px-2 py-0.5 bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 rounded border border-indigo-200/50 dark:border-indigo-800/50 font-mono"
              >
                <strong>{label}</strong>: {site}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 终审正文内容 */}
      {isExpanded && (
        <div className="relative">
          {synthesisRun.finalMarkdown ? (
            <div className="bg-white/90 dark:bg-slate-900/90 rounded-lg p-3 border border-slate-200/80 dark:border-slate-800 max-h-72 overflow-y-auto text-xs leading-relaxed font-sans whitespace-pre-wrap select-text">
              {synthesisRun.finalMarkdown}
            </div>
          ) : (
            <div className="text-center py-6 text-slate-400 text-xs italic bg-white/40 dark:bg-slate-900/40 rounded-lg border border-dashed border-slate-200 dark:border-slate-800">
              {synthesisRun.status === 'WAITING_READY' || synthesisRun.status === 'SENDING'
                ? '已打开 DeepSeek 新会话窗口，正在投递各方数据沙箱...'
                : '终审内容生成中，请稍候...'}
            </div>
          )}

          {synthesisRun.finalMarkdown && (
            <div className="flex items-center justify-end gap-2 mt-2">
              <button
                onClick={handleCopy}
                className="px-2.5 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-lg text-[11px] font-medium transition-colors cursor-pointer flex items-center gap-1 shadow-2xs"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                <span>{copied ? '已复制' : '复制终审报告'}</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
