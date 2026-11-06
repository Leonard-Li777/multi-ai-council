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
}

const STORAGE_KEY = 'MULTI_AI_FLIGHT_LOGS';
const MAX_LOGS = 500;

class FlightRecorder {
  private memoryBuffer: FlightLogEntry[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private isInitialized = false;

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

    const entry: FlightLogEntry = {
      timestamp: now.getTime(),
      timeStr,
      source,
      level,
      action,
      details,
    };

    // 控制台同步输出
    const prefix = `[FlightRecorder:${source}][${action}]`;
    if (level === 'ERROR') {
      console.error(prefix, details || '');
    } else if (level === 'WARN') {
      console.warn(prefix, details || '');
    } else {
      console.log(prefix, details || '');
    }

    this.memoryBuffer.push(entry);
    if (this.memoryBuffer.length > MAX_LOGS) {
      this.memoryBuffer.splice(0, this.memoryBuffer.length - MAX_LOGS);
    }

    this.scheduleFlush();
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
    lines.push('| 时间 | 模块/站点 | 级别 | 动作 | 详细参数 |');
    lines.push('|---|---|---|---|---|');

    // 只保留最近 80 条防止过长
    const recentLogs = logs.slice(-80);
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
      lines.push(`| ${log.timeStr} | ${log.source} | ${log.level} | \`${log.action}\` | ${detailsStr} |`);
    }

    return lines.join('\n');
  }
}

export const flightRecorder = new FlightRecorder();
