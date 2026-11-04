import React from 'react';
import type { ProviderRun, ProviderStatus } from '../lib/types/review-job';
import DOMPurify from 'dompurify';
import {
  Loader2,
  CheckCircle,
  AlertTriangle,
  ExternalLink,
  RotateCcw,
  ShieldAlert,
  XCircle,
} from 'lucide-react';

interface SiteStatusCardProps {
  run?: ProviderRun;
  siteName: string;
  onFocusTab: () => void;
  onRetry: () => void;
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
}) => {
  const status = run?.status || 'PENDING';
  const cfg = STATUS_CONFIG[status];
  const responseText = run?.cleanedResponse || run?.responseSnapshot || '';

  // 纯文本简单安全展示，防止脚本注入
  const sanitizedPreview = DOMPurify.sanitize(responseText);

  const isError =
    status === 'BLOCKED_CAPTCHA' ||
    status === 'BLOCKED_LOGIN' ||
    status === 'FAILED' ||
    status === 'TAB_CLOSED';

  return (
    <div
      className={`rounded-xl border p-3 mb-2.5 transition-all bg-white dark:bg-slate-900 ${
        isError
          ? 'border-rose-300 dark:border-rose-900 shadow-rose-100/50'
          : status === 'STREAMING'
          ? 'border-blue-400 dark:border-blue-700 shadow-blue-50/50'
          : 'border-slate-200 dark:border-slate-800'
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-xs text-slate-800 dark:text-slate-200">
            {siteName}
          </span>
          <span
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${cfg.bg} ${cfg.text}`}
          >
            {cfg.icon}
            {cfg.label}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onFocusTab}
            title="聚焦该站点标签页"
            className="p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
          {isError && (
            <button
              type="button"
              onClick={onRetry}
              title="重试该站点"
              className="p-1 rounded text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* 异常原因提示 */}
      {run?.errorReason && (
        <div className="text-[11px] text-rose-600 dark:text-rose-400 bg-rose-50 dark:bg-rose-950/60 p-2 rounded-lg mb-2 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span>{run.errorReason}</span>
        </div>
      )}

      {/* 回答实时抓取预览 */}
      {sanitizedPreview ? (
        <div className="mt-1">
          <div className="text-[11px] text-slate-400 mb-1 flex justify-between">
            <span>实时抓取（已剥离思考块）</span>
            <span>{sanitizedPreview.length} 字</span>
          </div>
          <div className="text-xs text-slate-700 dark:text-slate-300 bg-slate-50 dark:bg-slate-950/50 p-2.5 rounded-lg max-h-40 overflow-y-auto font-mono whitespace-pre-wrap leading-relaxed border border-slate-100 dark:border-slate-800/80">
            {sanitizedPreview}
          </div>
        </div>
      ) : (
        <div className="text-[11px] text-slate-400 italic py-1">
          {status === 'STREAMING' ? '正在接收实时内容...' : '暂无回答内容'}
        </div>
      )}
    </div>
  );
};
