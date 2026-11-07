import type { SupportedSite } from '../types/review-job';

export type LogSource = SupportedSite | 'Background' | 'SidePanel' | 'Interceptor' | 'System';
export type LogLevel = 'INFO' | 'WARN' | 'ERROR';

export interface FlightLogEntry {
  timestamp: number;
  timeStr: string;
  source: LogSource;
  level: LogLevel;
  action: string;
  details?: Record<string, unknown> | string;
  repeatCount?: number;
}

const STORAGE_KEY = 'MULTI_AI_FLIGHT_LOGS';
const MAX_LOGS = 500;

class FlightRecorder {
  private memoryBuffer: FlightLogEntry[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private isInitialized = false;
  // 用于抽样与高频动作节流的最近记录映射表：key -> { timestamp, entryIndex }
  private recentActionIndexMap = new Map<string, number>();

  constructor() {
    this.init();
  }

  private async init() {
    if (this.isInitialized) return;
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        const data = await chrome.storage.local.get(STORAGE_KEY);
        if (Array.isArray(data[STORAGE_KEY])) {
          this.memoryBuffer = data[STORAGE_KEY];
        }
      }
      this.isInitialized = true;
    } catch {
      // 静默降级
    }
  }

  /**
   * 判断当前是否处于 Content Script 网页沙箱环境
   */
  private isContentScriptContext(): boolean {
    return (
      typeof window !== 'undefined' &&
      typeof window.location !== 'undefined' &&
      (window.location.protocol === 'http:' || window.location.protocol === 'https:')
    );
  }

  public record(
    source: LogSource,
    action: string,
    details?: Record<string, unknown> | string,
    level: LogLevel = 'INFO'
  ): void {
    const now = new Date();
    const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now
      .getMinutes()
      .toString()
      .padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}.${now
      .getMilliseconds()
      .toString()
      .padStart(3, '0')}`;

    // 核心防御：若当前处于 Content Script，绝不私自覆盖 chrome.storage.local！
    // 统一通过 runtime.sendMessage 委托给 Background 单点集中管理与落盘
    if (this.isContentScriptContext()) {
      try {
        if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
          chrome.runtime.sendMessage({
            type: 'FLIGHT_LOG',
            payload: { source, action, details, level },
          }).catch(() => {});
        }
      } catch {}
      return;
    }

    // --- Background 集中聚合与抽样限流处理 ---
    const throttleKey = `${source}:${action}`;
    const lastEntry = this.memoryBuffer[this.memoryBuffer.length - 1];

    // 1. 严格全等连续折叠（同源、同级、同动作、同参数）
    const isSameDetails =
      (!details && !lastEntry?.details) ||
      (typeof details === 'string' && details === lastEntry?.details) ||
      (typeof details === 'object' &&
        typeof lastEntry?.details === 'object' &&
        JSON.stringify(details) === JSON.stringify(lastEntry?.details));

    if (
      lastEntry &&
      lastEntry.source === source &&
      lastEntry.level === level &&
      lastEntry.action === action &&
      isSameDetails
    ) {
      lastEntry.repeatCount = (lastEntry.repeatCount || 1) + 1;
      lastEntry.timestamp = now.getTime();
      lastEntry.timeStr = timeStr;
      this.scheduleFlush();
      return;
    }

    // 2. 抽样限流 (Sampling / Throttle)：针对 2 秒内同源同动作的密集日志强制抽样合并，杜绝动态 ID 导致的刷屏
    const existingIndex = this.recentActionIndexMap.get(throttleKey);
    if (existingIndex !== undefined && existingIndex < this.memoryBuffer.length) {
      const targetEntry = this.memoryBuffer[existingIndex];
      if (
        targetEntry &&
        targetEntry.source === source &&
        targetEntry.action === action &&
        now.getTime() - targetEntry.timestamp < 2000 &&
        level !== 'ERROR'
      ) {
        targetEntry.repeatCount = (targetEntry.repeatCount || 1) + 1;
        targetEntry.timestamp = now.getTime();
        targetEntry.timeStr = timeStr;
        if (details) targetEntry.details = details;
        this.scheduleFlush();
        return;
      }
    }

    // 控制台同步输出 (仅针对新建事件输出，避免控制台刷屏)
    const prefix = `[FlightRecorder:${source}][${action}]`;
    if (level === 'ERROR') {
      console.error(prefix, details || '');
    } else if (level === 'WARN') {
      console.warn(prefix, details || '');
    } else {
      console.log(prefix, details || '');
    }

    // 3. 正常写入新条目
    const entry: FlightLogEntry = {
      timestamp: now.getTime(),
      timeStr,
      source,
      level,
      action,
      details,
      repeatCount: 1,
    };

    this.memoryBuffer.push(entry);
    this.recentActionIndexMap.set(throttleKey, this.memoryBuffer.length - 1);

    // 4. 环形配额平衡修剪：若超出上限，优先淘汰占比过高（>25%）站点的最旧记录，防止某单站淹没全部历史
    if (this.memoryBuffer.length > MAX_LOGS) {
      this.pruneBufferWithQuota();
    }

    this.scheduleFlush();
  }

  /**
   * 环形配额修剪：保护多站点平衡，杜绝单站垄断
   */
  private pruneBufferWithQuota(): void {
    const toRemove = this.memoryBuffer.length - MAX_LOGS;
    if (toRemove <= 0) return;

    // 统计各站点条数
    const counts = new Map<LogSource, number>();
    for (const item of this.memoryBuffer) {
      counts.set(item.source, (counts.get(item.source) || 0) + 1);
    }

    // 查找超出配额上限（> 25%）的站点
    const quotaLimit = Math.floor(MAX_LOGS * 0.25);
    let removed = 0;
    for (let i = 0; i < this.memoryBuffer.length && removed < toRemove; i++) {
      const item = this.memoryBuffer[i];
      if (item && (counts.get(item.source) || 0) > quotaLimit) {
        this.memoryBuffer.splice(i, 1);
        counts.set(item.source, (counts.get(item.source) || 0) - 1);
        removed++;
        i--;
      }
    }

    // 若仍有溢出，按 FIFO 平滑截断
    if (this.memoryBuffer.length > MAX_LOGS) {
      this.memoryBuffer.splice(0, this.memoryBuffer.length - MAX_LOGS);
    }
  }

  public info(source: LogSource, action: string, details?: Record<string, unknown> | string): void {
    this.record(source, action, details, 'INFO');
  }

  public warn(source: LogSource, action: string, details?: Record<string, unknown> | string): void {
    this.record(source, action, details, 'WARN');
  }

  public error(source: LogSource, action: string, details?: Record<string, unknown> | string): void {
    this.record(source, action, details, 'ERROR');
  }

  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(async () => {
      this.flushTimer = null;
      try {
        if (typeof chrome !== 'undefined' && chrome.storage?.local) {
          await chrome.storage.local.set({ [STORAGE_KEY]: this.memoryBuffer });
        }
      } catch {
        // 静默
      }
    }, 300);
  }

  public async getLogs(): Promise<FlightLogEntry[]> {
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        const data = await chrome.storage.local.get(STORAGE_KEY);
        if (Array.isArray(data[STORAGE_KEY])) {
          return data[STORAGE_KEY];
        }
      }
    } catch {}
    return this.memoryBuffer;
  }

  public async clear(): Promise<void> {
    this.memoryBuffer = [];
    try {
      if (typeof chrome !== 'undefined' && chrome.storage?.local) {
        await chrome.storage.local.remove(STORAGE_KEY);
      }
    } catch {}
  }

  /**
   * 生成 Markdown 格式的完整可读诊断报告，方便一键粘贴给开发人员/AI
   */
  public async exportDiagnosticReport(): Promise<string> {
    const logs = await this.getLogs();
    const lines: string[] = [];
    lines.push('### ✈️ Multi-AI Council 飞行记录仪诊断报告');
    lines.push(`- **导出时间**: ${new Date().toLocaleString()}`);
    lines.push(`- **记录条数**: ${logs.length} 条 (环形上限 ${MAX_LOGS})`);
    lines.push('');

    // 1. 各站点最新生命周期状态快照总览表 (100% 覆盖所有站点，防止被局部日志稀释)
    const allSites: SupportedSite[] = ['DeepSeek', 'ChatGPT', 'Claude', 'Gemini', 'Qwen', 'Wenxin'];
    lines.push('#### 📊 各站点最新生命周期快照');
    lines.push('| 站点 | 最新动作 | 级别 | 发生时间 | 重复 | 最近详细参数 |');
    lines.push('|---|---|---|---|---|---|');

    for (const site of allSites) {
      // 倒序查找该站点的最新一条日志
      let latestEntry: FlightLogEntry | undefined;
      for (let i = logs.length - 1; i >= 0; i--) {
        const item = logs[i];
        if (item && item.source === site) {
          latestEntry = item;
          break;
        }
      }

      if (latestEntry) {
        let detailsStr = '';
        if (latestEntry.details) {
          if (typeof latestEntry.details === 'string') {
            detailsStr = latestEntry.details.replace(/\|/g, '\\|').replace(/\n/g, ' ');
          } else {
            try {
              detailsStr = JSON.stringify(latestEntry.details).replace(/\|/g, '\\|');
            } catch {
              detailsStr = String(latestEntry.details);
            }
          }
        }
        const repeat = latestEntry.repeatCount && latestEntry.repeatCount > 1 ? `x${latestEntry.repeatCount}` : '1';
        lines.push(`| **${site}** | \`${latestEntry.action}\` | ${latestEntry.level} | ${latestEntry.timeStr} | ${repeat} | ${detailsStr} |`);
      } else {
        lines.push(`| **${site}** | *(无日志)* | - | - | - | - |`);
      }
    }

    // 2. 站点隔离关键事件流水 (每个站点独立配额，100% 杜绝跨站淹没)
    lines.push('');
    lines.push('#### 📌 各站点独立事件轨迹 (站点隔离，杜绝相互掩盖)');
    const trackedSources: LogSource[] = ['DeepSeek', 'ChatGPT', 'Claude', 'Gemini', 'Qwen', 'Wenxin', 'Background'];
    for (const src of trackedSources) {
      const siteLogs = logs.filter((l) => l.source === src).slice(-6);
      if (siteLogs.length > 0) {
        lines.push(`\n**[${src}] (最近 ${siteLogs.length} 条)**`);
        lines.push('| 时间 | 级别 | 动作 | 重复 | 详细参数 |');
        lines.push('|---|---|---|---|---|');
        for (const log of siteLogs) {
          let detailsStr = '';
          if (log.details) {
            if (typeof log.details === 'string') {
              detailsStr = log.details.replace(/\|/g, '\\|').replace(/\n/g, ' ');
            } else {
              try {
                detailsStr = JSON.stringify(log.details).replace(/\|/g, '\\|');
              } catch {
                detailsStr = String(log.details);
              }
            }
          }
          const repeat = log.repeatCount && log.repeatCount > 1 ? `x${log.repeatCount}` : '1';
          lines.push(`| ${log.timeStr} | ${log.level} | \`${log.action}\` | ${repeat} | ${detailsStr} |`);
        }
      } else {
        lines.push(`\n**[${src}]**: *(暂无运行记录)*`);
      }
    }

    lines.push('');
    lines.push('#### 📜 全局近期事件明细 (最近 50 条)');
    lines.push('| 时间 | 模块/站点 | 级别 | 动作 | 重复 | 详细参数 |');
    lines.push('|---|---|---|---|---|---|');

    // 只保留最近 50 条防止过长
    const recentLogs = logs.slice(-50);
    for (const log of recentLogs) {
      let detailsStr = '';
      if (log.details) {
        if (typeof log.details === 'string') {
          detailsStr = log.details.replace(/\|/g, '\\|').replace(/\n/g, ' ');
        } else {
          try {
            detailsStr = JSON.stringify(log.details).replace(/\|/g, '\\|');
          } catch {
            detailsStr = String(log.details);
          }
        }
      }
      const repeat = log.repeatCount && log.repeatCount > 1 ? `x${log.repeatCount}` : '1';
      lines.push(`| ${log.timeStr} | ${log.source} | ${log.level} | \`${log.action}\` | ${repeat} | ${detailsStr} |`);
    }

    return lines.join('\n');
  }
}

export const flightRecorder = new FlightRecorder();
