import React from 'react';
import type { SupportedSite, ProviderRun } from '../lib/types/review-job';
import { Bot, Check, ExternalLink, Loader2 } from 'lucide-react';

interface SiteChecklistProps {
  selectedSites: SupportedSite[];
  onChange: (sites: SupportedSite[]) => void;
  onOpenSite?: (site: SupportedSite) => void;
  onOpenAllSites?: () => void;
  runs?: Record<string, ProviderRun>;
  disabled?: boolean;
}

export interface SiteDefinition {
  id: SupportedSite;
  name: string;
  url: string;
  isReady: boolean; // 是否已完全实现适配器
}

export const SUPPORTED_SITES: SiteDefinition[] = [
  { id: 'DeepSeek', name: 'DeepSeek', url: 'https://chat.deepseek.com', isReady: true },
  { id: 'ChatGPT', name: 'ChatGPT', url: 'https://chatgpt.com', isReady: true },
  { id: 'Claude', name: 'Claude', url: 'https://claude.ai', isReady: true },
  { id: 'Gemini', name: 'Gemini', url: 'https://gemini.google.com', isReady: true },
  { id: 'Qwen', name: '通义千问', url: 'https://chat.qwen.ai', isReady: true },
  { id: 'Wenxin', name: '文心一言', url: 'https://wenxin.baidu.com', isReady: true },
  { id: 'ChatGLM', name: '智谱清言', url: 'https://chatglm.cn', isReady: true },
];

export const SiteChecklist: React.FC<SiteChecklistProps> = ({
  selectedSites,
  onChange,
  onOpenSite,
  onOpenAllSites,
  runs,
  disabled = false,
}) => {
  const toggleSite = (siteId: SupportedSite) => {
    if (disabled) return;
    if (selectedSites.includes(siteId)) {
      if (selectedSites.length > 1) {
        onChange(selectedSites.filter((s) => s !== siteId));
      }
    } else {
      onChange([...selectedSites, siteId]);
    }
  };

  const handleSelectAll = () => {
    if (disabled) return;
    onChange(SUPPORTED_SITES.map((s) => s.id));
  };

  const handleSelectOnlyReady = () => {
    if (disabled) return;
    onChange(['DeepSeek']);
  };

  return (
    <div className="shrink-0 bg-white/95 dark:bg-slate-900/95 p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs mb-2">
      <div className="flex items-center justify-between mb-1.5 flex-wrap gap-1">
        <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
          <Bot className="w-3.5 h-3.5 text-blue-500" />
          <span>站点开启/关闭及状态</span>
          <span className="text-[11px] font-normal text-slate-400">
            ({selectedSites.length}/{SUPPORTED_SITES.length} 生效)
          </span>
        </span>

        <div className="flex items-center gap-1.5 text-[11px]">
          {onOpenAllSites && (
            <button
              type="button"
              onClick={onOpenAllSites}
              title="一键打开所选站点的浏览器窗口，方便先去登录"
              className="text-blue-600 dark:text-blue-400 hover:text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950/60 px-1.5 py-0.5 rounded flex items-center gap-1 border border-blue-200/80 dark:border-blue-800/80 transition-colors cursor-pointer"
            >
              <ExternalLink className="w-3 h-3" />
              <span>打开勾选窗口登录</span>
            </button>
          )}
          <button
            type="button"
            disabled={disabled}
            onClick={handleSelectAll}
            className="text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:underline px-1 py-0.5 rounded cursor-pointer"
          >
            全选
          </button>
          <span className="text-slate-300 dark:text-slate-700">|</span>
          <button
            type="button"
            disabled={disabled}
            onClick={handleSelectOnlyReady}
            className="text-slate-500 dark:text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:underline px-1 py-0.5 rounded cursor-pointer"
          >
            仅DeepSeek
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        {SUPPORTED_SITES.map((site) => {
          const isEnabled = selectedSites.includes(site.id);
          const run = runs?.[site.id];

          // 状态解析
          let statusLabel = isEnabled ? '已就绪' : '已停用';
          let statusDot = isEnabled ? 'bg-emerald-500' : 'bg-slate-400';
          let statusPillClass = isEnabled
            ? 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-400'
            : 'bg-slate-200/60 dark:bg-slate-800 text-slate-400';

          if (run) {
            if (run.status === 'STREAMING') {
              statusLabel = '生成中';
              statusDot = 'bg-blue-500 animate-pulse';
              statusPillClass = 'bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300';
            } else if (run.status === 'DONE' || run.status === 'PARTIAL') {
              statusLabel = '已完成';
              statusDot = 'bg-emerald-500';
              statusPillClass = 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300';
            } else if (run.status === 'BLOCKED_LOGIN') {
              statusLabel = '待登录';
              statusDot = 'bg-amber-500 animate-bounce';
              statusPillClass = 'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 font-bold';
            } else if (run.status === 'BLOCKED_CAPTCHA') {
              statusLabel = '需验证';
              statusDot = 'bg-rose-500 animate-pulse';
              statusPillClass = 'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300';
            } else if (run.status === 'FAILED') {
              statusLabel = '异常';
              statusDot = 'bg-rose-500';
              statusPillClass = 'bg-rose-100 dark:bg-rose-950 text-rose-600 dark:text-rose-400';
            } else if (run.status === 'SENDING' || run.status === 'OPENING_TAB' || run.status === 'WAITING_READY') {
              statusLabel = '连接中';
              statusDot = 'bg-blue-400 animate-spin';
              statusPillClass = 'bg-blue-50 dark:bg-blue-950 text-blue-600';
            }
          }

          return (
            <div
              key={site.id}
              onClick={() => toggleSite(site.id)}
              className={`flex items-center justify-between px-2 py-1.5 rounded-lg border text-xs cursor-pointer select-none transition-all ${
                isEnabled
                  ? 'bg-blue-50/70 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800 text-slate-900 dark:text-slate-100 shadow-2xs'
                  : 'bg-slate-50/50 dark:bg-slate-900/50 border-slate-200/80 dark:border-slate-800/80 text-slate-400 opacity-60 hover:opacity-100'
              } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDot}`} />
                <div className="font-medium truncate text-xs">
                  {site.name}
                </div>
              </div>

              {/* 独立打开窗口登录按钮 + 状态标签 */}
              <div className="flex items-center gap-1 shrink-0 ml-1">
                {onOpenSite && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenSite(site.id);
                    }}
                    title={`打开 ${site.name} 窗口以登录`}
                    className="p-1 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-100/50 dark:hover:bg-blue-900/50 transition-colors cursor-pointer"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </button>
                )}
                <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-medium ${statusPillClass}`}>
                  {statusLabel}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

