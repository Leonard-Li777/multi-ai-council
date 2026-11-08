import React, { useState } from 'react';
import type { ProviderRun, ProviderStatus } from '../lib/types/review-job';
import { stripThinkBlocks } from '../lib/utils/think-block-strip';
import DOMPurify from 'dompurify';
import {
  Loader2,
  CheckCircle,
  AlertTriangle,
  ExternalLink,
  RotateCcw,
  ShieldAlert,
  XCircle,
  SkipForward,
  Copy,
  Check,
  ChevronDown,
} from 'lucide-react';

export interface SiteStatusCardProps {
  run?: ProviderRun;
  siteName: string;
  onFocusTab: () => void;
  onRetry: () => void;
  onSkip?: () => void;
  isExpanded?: boolean;
  onToggleExpand?: () => void;
}

const STATUS_CONFIG: Record<
  ProviderStatus,
  { label: string; bg: string; text: string; icon: React.ReactNode }
> = {
  PENDING: { label: '等待调度', bg: 'bg-slate-100 dark:bg-slate-800', text: 'text-slate-500', icon: null },
  OPENING_TAB: { label: '打开标签页', bg: 'bg-blue-50 dark:bg-blue-950', text: 'text-blue-600', icon: <Loader2 className="w-3.5 h-3.5 animate-spin" /> },
  WAITING_READY: { label: '等待就绪', bg: 'bg-indigo-50 dark:bg-indigo-950', text: 'text-indigo-600', icon: <Loader2 className="w-3.5 h-3.5 animate-spin" /> },
  SENDING: { label: '正在提交', bg: 'bg-amber-50 dark:bg-amber-950', text: 'text-amber-600', icon: <Loader2 className="w-3.5 h-3.5 animate-spin" /> },
  STREAMING: { label: '正在生成', bg: 'bg-blue-50 dark:bg-blue-950', text: 'text-blue-600', icon: <Loader2 className="w-3.5 h-3.5 animate-spin" /> },
  DONE: { label: '已完成', bg: 'bg-emerald-50 dark:bg-emerald-950', text: 'text-emerald-600', icon: <CheckCircle className="w-3.5 h-3.5" /> },
  PARTIAL: { label: '降级完成', bg: 'bg-yellow-50 dark:bg-yellow-950', text: 'text-yellow-600', icon: <CheckCircle className="w-3.5 h-3.5" /> },
  BLOCKED_LOGIN: { label: '未登录', bg: 'bg-rose-50 dark:bg-rose-950', text: 'text-rose-600', icon: <ShieldAlert className="w-3.5 h-3.5" /> },
  BLOCKED_CAPTCHA: { label: '需人机验证', bg: 'bg-rose-50 dark:bg-rose-950', text: 'text-rose-600', icon: <AlertTriangle className="w-3.5 h-3.5 animate-pulse" /> },
  RATE_LIMITED: { label: '触发限流', bg: 'bg-amber-50 dark:bg-amber-950', text: 'text-amber-600', icon: <AlertTriangle className="w-3.5 h-3.5" /> },
  TIMEOUT: { label: '生成超时', bg: 'bg-slate-100 dark:bg-slate-800', text: 'text-slate-600', icon: <XCircle className="w-3.5 h-3.5" /> },
  TAB_CLOSED: { label: '标签页已关闭', bg: 'bg-rose-50 dark:bg-rose-950', text: 'text-rose-600', icon: <XCircle className="w-3.5 h-3.5" /> },
  FAILED: { label: '生成失败', bg: 'bg-rose-50 dark:bg-rose-950', text: 'text-rose-600', icon: <XCircle className="w-3.5 h-3.5" /> },
  CANCELED: { label: '已取消', bg: 'bg-slate-100 dark:bg-slate-800', text: 'text-slate-500', icon: null },
};

export const SiteStatusCard: React.FC<SiteStatusCardProps> = ({
  run,
  siteName,
  onFocusTab,
  onRetry,
  onSkip,
  isExpanded,
  onToggleExpand,
}) => {
  const status = run?.status || 'PENDING';
  const cfg = STATUS_CONFIG[status];
  // 严格正文解析：优先使用已剥离思考块的 cleanedResponse；若退化至 responseSnapshot，必须同样经由 stripThinkBlocks 剥离思考占位
  let effectiveText = (run?.cleanedResponse || '').trim();
  if (!effectiveText && run?.responseSnapshot) {
    const { cleaned } = stripThinkBlocks(run.responseSnapshot);
    effectiveText = cleaned.trim();
  }
  // 纯文本简单安全展示，防止脚本注入并去除任何非法标记
  const sanitizedPreview = DOMPurify.sanitize(effectiveText);
  // 字数统计以净化后实际可见内容为准，杜绝未剥离内联标签导致显示虚高
  const charCount = sanitizedPreview.length;
  const [copied, setCopied] = useState(false);
  const [internalExpanded, setInternalExpanded] = useState<boolean>(true);

  const expanded = isExpanded !== undefined ? isExpanded : internalExpanded;
  const handleToggle = () => {
    if (onToggleExpand) {
      onToggleExpand();
    } else {
      setInternalExpanded((prev) => !prev);
    }
  };

  const handleCopy = async (e?: React.MouseEvent) => {
    e?.stopPropagation();
    if (!effectiveText) return;
    try {
      await navigator.clipboard.writeText(effectiveText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.warn('[SiteStatusCard] Copy failed:', err);
    }
  };

  const isError =
    status === 'BLOCKED_CAPTCHA' ||
    status === 'BLOCKED_LOGIN' ||
    status === 'FAILED' ||
    status === 'TAB_CLOSED';

  const canSkip =
    status === 'WAITING_READY' ||
    status === 'SENDING' ||
    status === 'STREAMING' ||
    status === 'BLOCKED_CAPTCHA' ||
    status === 'BLOCKED_LOGIN' ||
    status === 'RATE_LIMITED' ||
    status === 'TIMEOUT';

  return (
    <div
      className={`rounded-xl border mb-2 transition-all bg-white dark:bg-slate-900 shadow-2xs overflow-hidden ${
        isError
          ? 'border-rose-300 dark:border-rose-900 shadow-rose-100/50'
          : status === 'STREAMING'
          ? 'border-blue-400 dark:border-blue-700 shadow-blue-50/50'
          : 'border-slate-200 dark:border-slate-800'
      }`}
    >
      {/* 手风琴标题栏：支持点击展开/折叠，包含状态徽标、字数统计与一键复制 */}
      <div
        onClick={handleToggle}
        className="flex items-center justify-between p-2.5 cursor-pointer select-none hover:bg-slate-50/70 dark:hover:bg-slate-800/40 rounded-xl transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1 mr-2">
          <ChevronDown
            className={`w-3.5 h-3.5 shrink-0 text-slate-400 transition-transform duration-200 ${
              expanded ? 'rotate-0' : '-rotate-90'
            }`}
          />
          <span className="font-semibold text-xs text-slate-800 dark:text-slate-200 shrink-0">
            {siteName}
          </span>
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium shrink-0 ${cfg.bg} ${cfg.text}`}
          >
            {cfg.icon}
            {cfg.label}
          </span>
          {charCount > 0 && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200/60 dark:border-slate-700/60 shrink-0">
              {charCount} 字
            </span>
          )}
        </div>

        {/* 右侧动作工具条（点击阻止冒泡） */}
        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          {charCount > 0 && (
            <button
              type="button"
              onClick={handleCopy}
              title={copied ? '已复制该回复' : `一键复制 ${siteName} 回复 (${charCount} 字)`}
              className="p-1 rounded text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 transition-colors cursor-pointer flex items-center gap-0.5"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </button>
          )}
          {canSkip && onSkip && (
            <button
              type="button"
              onClick={onSkip}
              title="跳过此站点等待，避免阻塞终审"
              className="p-1 rounded text-slate-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/60 transition-colors cursor-pointer"
            >
              <SkipForward className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={onFocusTab}
            title="聚焦该站点标签页"
            className="p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              title="一键自愈：检测异常并自动继续下一动作"
              className="p-1 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/60 transition-colors cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* 手风琴主体详情：折叠时隐藏，展开时显示异常引导及回答富文本预览 */}
      {expanded && (
        <div className="px-3 pb-3 pt-1 border-t border-slate-100 dark:border-slate-800/60">
          {/* 异常原因提示与自愈引导条 */}
          {run?.errorReason && status !== 'BLOCKED_LOGIN' && status !== 'BLOCKED_CAPTCHA' && (
            <div className="bg-rose-50 dark:bg-rose-950/70 border border-rose-200 dark:border-rose-900/80 p-2.5 rounded-lg mb-2 text-xs">
              <div className="flex items-center gap-1.5 text-rose-700 dark:text-rose-300 mb-2">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                <span className="font-medium">{run.errorReason}</span>
              </div>
              <div className="flex items-center justify-end gap-1.5">
                <button
                  type="button"
                  onClick={onFocusTab}
                  className="px-2 py-1 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded text-[11px] font-medium flex items-center gap-1 cursor-pointer"
                >
                  <ExternalLink className="w-3 h-3" />
                  前往处理
                </button>
                <button
                  type="button"
                  onClick={onRetry}
                  className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-[11px] font-medium flex items-center gap-1 shadow-2xs cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  已处理异常，自动继续
                </button>
              </div>
            </div>
          )}

          {/* 未登录专向引导卡片 */}
          {status === 'BLOCKED_LOGIN' && (
            <div className="bg-amber-50 dark:bg-amber-950/70 border border-amber-200 dark:border-amber-800 p-2.5 rounded-lg mb-2 flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-1.5 text-amber-800 dark:text-amber-200 min-w-0">
                <ShieldAlert className="w-4 h-4 shrink-0 text-amber-600" />
                <span className="truncate">该窗口未登录，请登录后重试</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={onFocusTab}
                  className="px-2 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-[11px] font-medium flex items-center gap-1 shadow-2xs cursor-pointer"
                >
                  <ExternalLink className="w-3 h-3" />
                  前往登录
                </button>
                <button
                  type="button"
                  onClick={onRetry}
                  className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[11px] font-medium flex items-center gap-1 shadow-2xs cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  已登录重试
                </button>
              </div>
            </div>
          )}

          {/* 验证码专向引导卡片 */}
          {status === 'BLOCKED_CAPTCHA' && (
            <div className="bg-rose-50 dark:bg-rose-950/70 border border-rose-200 dark:border-rose-800 p-2.5 rounded-lg mb-2 flex items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-1.5 text-rose-800 dark:text-rose-200 min-w-0">
                <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600 animate-pulse" />
                <span className="truncate">需人机验证，请人工通过</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={onFocusTab}
                  className="px-2 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded text-[11px] font-medium flex items-center gap-1 shadow-2xs cursor-pointer"
                >
                  <ExternalLink className="w-3 h-3" />
                  前往验证
                </button>
                <button
                  type="button"
                  onClick={onRetry}
                  className="px-2 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-[11px] font-medium flex items-center gap-1 shadow-2xs cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  已验证重试
                </button>
              </div>
            </div>
          )}

          {/* 回答实时抓取预览 */}
          {sanitizedPreview ? (
            <div className="mt-1">
              <div className="text-[11px] text-slate-400 mb-1 flex items-center justify-between">
                <span>实时抓取（已剥离思考块 · {sanitizedPreview.length} 字）</span>
                <button
                  type="button"
                  onClick={handleCopy}
                  className="text-[11px] text-indigo-600 dark:text-indigo-400 hover:text-indigo-700 dark:hover:text-indigo-300 flex items-center gap-1 cursor-pointer font-medium"
                  title="一键复制回复内容"
                >
                  {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                  <span>{copied ? '已复制' : '复制内容'}</span>
                </button>
              </div>
              <div className="text-xs text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-950/50 p-2.5 rounded-lg max-h-56 overflow-y-auto font-mono whitespace-pre-wrap leading-relaxed border border-slate-100 dark:border-slate-800/80 select-text">
                {sanitizedPreview}
              </div>
            </div>
          ) : (
            <div className="text-[11px] text-slate-400 italic py-1">
              {status === 'STREAMING'
                ? run?.responseSnapshot && run.responseSnapshot.length > 0
                  ? '💭 正在深度思考中，静待正文吐出...'
                  : '正在接收实时内容...'
                : '暂无回答内容'}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
