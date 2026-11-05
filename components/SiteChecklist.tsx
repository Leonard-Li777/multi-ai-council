import React from 'react';
import type { SupportedSite } from '../lib/types/review-job';
import { Bot, Check, ExternalLink } from 'lucide-react';

interface SiteChecklistProps {
  selectedSites: SupportedSite[];
  onChange: (sites: SupportedSite[]) => void;
  onOpenSite?: (site: SupportedSite) => void;
  onOpenAllSites?: () => void;
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
    <div className="bg-white/90 dark:bg-slate-900/90 p-3 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs mb-3">
      <div className="flex items-center justify-between mb-2.5 flex-wrap gap-1.5">
        <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
          <Bot className="w-3.5 h-3.5 text-blue-500" />
          <span>站点开启/关闭</span>
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

          return (
            <div
              key={site.id}
              onClick={() => toggleSite(site.id)}
              className={`flex items-center justify-between p-2 rounded-lg border text-xs cursor-pointer select-none transition-all ${
                isEnabled
                  ? 'bg-blue-50/70 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800 text-slate-900 dark:text-slate-100 shadow-2xs'
                  : 'bg-slate-50/50 dark:bg-slate-900/50 border-slate-200/80 dark:border-slate-800/80 text-slate-400 opacity-70 hover:opacity-100'
              } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
            >
              <div className="flex items-center gap-2 min-w-0">
                <div
                  className={`w-4 h-4 rounded flex items-center justify-center shrink-0 transition-colors ${
                    isEnabled
                      ? 'bg-blue-600 text-white'
                      : 'border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800'
                  }`}
                >
                  {isEnabled && <Check className="w-3 h-3 stroke-[3]" />}
                </div>
                <div className="min-w-0">
                  <div className="font-medium truncate flex items-center gap-1">
                    <span>{site.name}</span>
                    {site.isReady && (
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500" title="适配器已就绪" />
                    )}
                  </div>
                  <div className="text-[10px] text-slate-400 truncate">
                    {site.url.replace(/^https?:\/\//, '')}
                  </div>
                </div>
              </div>

              {/* 独立打开窗口登录按钮 + 开启/关闭状态开关 */}
              <div className="flex items-center gap-1 shrink-0 ml-1">
                {onOpenSite && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenSite(site.id);
                    }}
                    title={`打开 ${site.name} 窗口以登录`}
                    className="p-1 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-100/50 dark:hover:bg-blue-900/50 transition-colors"
                  >
                    <ExternalLink className="w-3 h-3" />
                  </button>
                )}
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                    isEnabled
                      ? 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-400'
                      : 'bg-slate-200/60 dark:bg-slate-800 text-slate-400'
                  }`}
                >
                  {isEnabled ? '生效' : '停用'}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
