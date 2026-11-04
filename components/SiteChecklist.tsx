import React from 'react';
import type { SupportedSite } from '../lib/types/review-job';
import { Bot, Check, CheckSquare, Square, Power } from 'lucide-react';

interface SiteChecklistProps {
  selectedSites: SupportedSite[];
  onChange: (sites: SupportedSite[]) => void;
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
  { id: 'Qwen', name: '通义千问', url: 'https://chat.qwen.ai', isReady: false },
  { id: 'Wenxin', name: '文心一言', url: 'https://wenxin.baidu.com', isReady: false },
  { id: 'ChatGLM', name: '智谱清言', url: 'https://chatglm.cn', isReady: false },
  { id: 'ChatGPT', name: 'ChatGPT', url: 'https://chatgpt.com', isReady: false },
  { id: 'Claude', name: 'Claude', url: 'https://claude.ai', isReady: false },
  { id: 'Gemini', name: 'Gemini', url: 'https://gemini.google.com', isReady: false },
];

export const SiteChecklist: React.FC<SiteChecklistProps> = ({
  selectedSites,
  onChange,
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
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
          <Bot className="w-3.5 h-3.5 text-blue-500" />
          <span>站点开启/关闭项</span>
          <span className="text-[11px] font-normal text-slate-400">
            ({selectedSites.length} / {SUPPORTED_SITES.length} 生效)
          </span>
        </span>

        <div className="flex items-center gap-1 text-[11px]">
          <button
            type="button"
            disabled={disabled}
            onClick={handleSelectAll}
            className="text-blue-600 dark:text-blue-400 hover:underline px-1 py-0.5 rounded"
          >
            全选
          </button>
          <span className="text-slate-300 dark:text-slate-700">|</span>
          <button
            type="button"
            disabled={disabled}
            onClick={handleSelectOnlyReady}
            className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 px-1 py-0.5 rounded"
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

              {/* 开启/关闭状态开关图标 */}
              <div className="shrink-0 ml-1">
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
                    isEnabled
                      ? 'bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-400'
                      : 'bg-slate-200/60 dark:bg-slate-800 text-slate-400'
                  }`}
                >
                  {isEnabled ? '已开启' : '已关闭'}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
