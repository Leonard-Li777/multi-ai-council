import React, { useState, useMemo } from 'react';
import type { SynthesisRun, ProviderStatus, ReviewJob, SupportedSite } from '../lib/types/review-job';
import {
  Sparkles,
  Copy,
  Check,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Download,
  FileText,
  FileCode,
  ExternalLink,
  Play,
} from 'lucide-react';
import {
  revealModelIdentities,
  sanitizeHtml,
  exportJobAsJson,
  exportReportAsMarkdown,
} from '../lib/utils/markdown-viewer';
import { buildAllCompletedResponsesText } from '../lib/utils/synthesis-builder';

interface SynthesisCardProps {
  synthesisRun?: SynthesisRun;
  activeJob?: ReviewJob | null;
  judgeSite?: SupportedSite;
  onFocusSynthesisTab?: () => void;
  onTriggerSynthesis?: () => void;
  canTriggerSynthesis?: boolean;
}

export const SynthesisCard: React.FC<SynthesisCardProps> = ({
  synthesisRun,
  activeJob,
  judgeSite = 'DeepSeek',
  onFocusSynthesisTab,
  onTriggerSynthesis,
  canTriggerSynthesis,
}) => {
  const [copied, setCopied] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);
  const [isExpanded, setIsExpanded] = useState(true);
  const [revealIdentities, setRevealIdentities] = useState(false);

  const status = synthesisRun?.status || 'PENDING';

  // 串联所有已完成站点的回复 Markdown 文本
  const allResponsesText = useMemo(() => {
    return buildAllCompletedResponsesText(activeJob);
  }, [activeJob]);

  const hasAnyResponses = allResponsesText.trim().length > 0;

  const handleCopy = async () => {
    if (!displayText) return;
    try {
      await navigator.clipboard.writeText(displayText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.warn('Copy failed', e);
    }
  };

  const handleCopyAllResponses = async () => {
    if (!allResponsesText) return;
    try {
      await navigator.clipboard.writeText(allResponsesText);
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 2000);
    } catch (e) {
      console.warn('Copy all responses failed', e);
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

  const currentCfg = statusConfig[status] || statusConfig.PENDING;

  // 依据是否勾选“查看模型真身”动态转换正文
  const displayText = useMemo(() => {
    const raw = synthesisRun?.finalMarkdown || '';
    if (!raw) return '';
    if (revealIdentities && synthesisRun?.anonymousMap) {
      return revealModelIdentities(raw, synthesisRun.anonymousMap);
    }
    return raw;
  }, [synthesisRun?.finalMarkdown, revealIdentities, synthesisRun?.anonymousMap]);

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
              <span>{judgeSite} 汇总窗口</span>
              {status === 'STREAMING' && (
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping inline-block" />
              )}
            </div>
            <span className="text-[10px] text-slate-400">全景综合汇总 · 汇集他方观点 · 当前会话深度提炼</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {hasAnyResponses && (
            <button
              type="button"
              onClick={handleCopyAllResponses}
              title={copiedAll ? '已复制所有站点的串联回复' : '一键复制所有站点的串联回复'}
              className="px-2 py-0.5 rounded text-indigo-700 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-950/70 hover:bg-indigo-100 dark:hover:bg-indigo-900/80 transition-colors cursor-pointer flex items-center gap-1 text-[11px] font-medium border border-indigo-200/50 dark:border-indigo-800/50"
            >
              {copiedAll ? <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-3 h-3" />}
              <span>{copiedAll ? '已复制全站' : '复制全站回复'}</span>
            </button>
          )}

          {displayText && (
            <button
              type="button"
              onClick={handleCopy}
              title={copied ? '已复制汇总内容' : '一键复制汇总内容'}
              className="px-2 py-0.5 rounded text-indigo-700 dark:text-indigo-300 bg-indigo-100/70 dark:bg-indigo-950/80 hover:bg-indigo-200/80 dark:hover:bg-indigo-900/90 transition-colors cursor-pointer flex items-center gap-1 text-[11px] font-medium"
            >
              {copied ? <Check className="w-3 h-3 text-emerald-600 dark:text-emerald-400" /> : <Copy className="w-3 h-3" />}
              <span>{copied ? '已复制' : '复制汇总'}</span>
            </button>
          )}

          {onFocusSynthesisTab && (
            <button
              type="button"
              onClick={onFocusSynthesisTab}
              title="聚焦 DeepSeek 汇总标签页"
              className="p-1 rounded text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </button>
          )}

          <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${currentCfg.color}`}>
            {currentCfg.label}
          </span>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors cursor-pointer"
          >
            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          </button>
        </div>
      </div>

      {/* 匿名打乱映射指示器与揭晓开关 */}
      {Object.keys(synthesisRun?.anonymousMap || {}).length > 0 && (
        <div className="mb-2.5 bg-white/80 dark:bg-slate-900/80 p-2 rounded-lg border border-indigo-100/60 dark:border-indigo-900/40 text-[10px]">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-slate-400 font-medium">各模型匿名盲审对照：</span>
            <button
              onClick={() => setRevealIdentities(!revealIdentities)}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors cursor-pointer ${
                revealIdentities
                  ? 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
              }`}
            >
              {revealIdentities ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              <span>{revealIdentities ? '隐藏模型真身' : '查看模型真身'}</span>
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {Object.entries(synthesisRun?.anonymousMap || {}).map(([label, site]) => (
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
          {displayText ? (
            <div className="bg-white/90 dark:bg-slate-900/90 rounded-lg p-3 border border-slate-200/80 dark:border-slate-800 max-h-72 overflow-y-auto text-xs leading-relaxed font-sans whitespace-pre-wrap select-text">
              {displayText}
            </div>
          ) : (
            <div className="text-center py-5 px-3 text-slate-400 text-xs italic bg-white/40 dark:bg-slate-900/40 rounded-lg border border-dashed border-slate-200 dark:border-slate-800 space-y-2">
              <p>
                {status === 'WAITING_READY' || status === 'SENDING'
                  ? `正在向 ${judgeSite} 当前会话分轮投递各 AI 回复数据进行全景汇总...`
                  : status === 'STREAMING'
                  ? `${judgeSite} 正在综合提炼并生成最终汇总报告，不漏掉任何不同观点...`
                  : `终审支持两种处理方式：可分轮提交至 ${judgeSite} 生成深度聚合报告，或直接一键串联复制所有站点的原始回复。`}
              </p>
              {status !== 'STREAMING' && (
                <div className="pt-2 flex flex-wrap items-center justify-center gap-2 not-italic">
                  {canTriggerSynthesis && onTriggerSynthesis && (
                    <button
                      type="button"
                      onClick={onTriggerSynthesis}
                      className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 shadow-2xs transition-all cursor-pointer active:scale-95"
                    >
                      <Play className="w-3.5 h-3.5 fill-current" />
                      <span>{status === 'FAILED' ? `重试提交至 ${judgeSite} 终审` : `提交至 ${judgeSite} 终审`}</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleCopyAllResponses}
                    disabled={!hasAnyResponses}
                    title={hasAnyResponses ? '将所有站点的回复串联复制到剪贴板' : '暂无有效站点回复可复制'}
                    className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1.5 transition-all cursor-pointer border ${
                      copiedAll
                        ? 'bg-emerald-50 text-emerald-700 border-emerald-300 dark:bg-emerald-950 dark:text-emerald-300'
                        : hasAnyResponses
                        ? 'bg-white dark:bg-slate-800 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800 hover:bg-indigo-50 dark:hover:bg-indigo-950/60 shadow-2xs active:scale-95'
                        : 'bg-slate-100 text-slate-400 border-slate-200 cursor-not-allowed dark:bg-slate-800 dark:text-slate-600'
                    }`}
                  >
                    {copiedAll ? (
                      <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <Copy className="w-3.5 h-3.5 text-indigo-500" />
                    )}
                    <span>{copiedAll ? '已复制所有回复' : '一键复制所有回复'}</span>
                  </button>
                </div>
              )}
            </div>
          )}

          {synthesisRun?.finalMarkdown && (
            <div className="flex items-center justify-between gap-2 mt-2 pt-2 border-t border-slate-100 dark:border-slate-800/60">
              <div className="flex items-center gap-1.5">
                {activeJob && (
                  <>
                    <button
                      onClick={() => exportReportAsMarkdown(activeJob, revealIdentities)}
                      className="px-2 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg text-[10px] font-medium transition-colors cursor-pointer flex items-center gap-1"
                      title="下载聚合报告 Markdown 文件"
                    >
                      <FileText className="w-3 h-3 text-blue-500" />
                      <span>MD 报告</span>
                    </button>
                    <button
                      onClick={() => exportJobAsJson(activeJob)}
                      className="px-2 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg text-[10px] font-medium transition-colors cursor-pointer flex items-center gap-1"
                      title="下载完整任务快照 JSON 文件"
                    >
                      <FileCode className="w-3 h-3 text-purple-500" />
                      <span>JSON 快照</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleCopyAllResponses}
                      disabled={!hasAnyResponses}
                      className="px-2 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-lg text-[10px] font-medium transition-colors cursor-pointer flex items-center gap-1"
                      title="将所有站点的原始回复串联复制到剪贴板"
                    >
                      {copiedAll ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3 text-indigo-500" />}
                      <span>{copiedAll ? '已复制全站' : '复制全站回复'}</span>
                    </button>
                  </>
                )}
              </div>

              <button
                onClick={handleCopy}
                className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[11px] font-medium transition-colors cursor-pointer flex items-center gap-1 shadow-2xs"
              >
                {copied ? <Check className="w-3 h-3 text-emerald-300" /> : <Copy className="w-3 h-3" />}
                <span>{copied ? '已复制' : '一键复制汇总内容'}</span>
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
