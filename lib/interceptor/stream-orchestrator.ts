import type { StreamFramePayload } from '../types/interceptor';
import {
  matchGenerationEndpoint,
  UnifiedSemanticStreamParser,
  type SemanticEvent,
} from '../parsers/semantic-stream-parser';

export type OrchestratorState =
  | 'IDLE'
  | 'PENDING_STREAM'
  | 'STREAMING'
  | 'DONE'
  | 'PARTIAL'
  | 'ERROR'
  | 'DOM_FALLBACK';

export interface StreamOrchestratorOptions {
  onPauseDom?: () => void;
  onResumeDom?: () => void;
  checkDomHasContent?: () => boolean;
  onSnapshotUpdate?: (text: string) => void;
  onThinkingHeartbeat?: (text: string) => void;
  onStateChange?: (state: OrchestratorState) => void;
}

/**
 * 双轨因果状态机与活跃流互斥控制器 (Active Stream Lock & Dual-Track Orchestrator)
 */
export class StreamOrchestrator {
  private state: OrchestratorState = 'IDLE';
  private currentJobId: string | null = null;
  private currentPrompt = '';
  private activeStreamId: string | null = null;
  private responseSnapshot = '';
  private ttftTimer: number | null = null;
  private readonly TTFT_TIMEOUT_MS = 15_000; // 15秒抗高峰 TTFT
  private activeParser?: UnifiedSemanticStreamParser;

  private options: StreamOrchestratorOptions;

  constructor(options: StreamOrchestratorOptions = {}) {
    this.options = options;
  }

  public dispatchPrompt(jobId: string, prompt: string): void {
    this.currentJobId = jobId;
    this.currentPrompt = prompt || '';
    this.activeStreamId = null;
    this.responseSnapshot = '';
    this.activeParser = undefined;
    this.setState('PENDING_STREAM');

    // 启动 15 秒因果超时安全网
    this.refreshTtftTimer();
  }

  /**
   * AC9: Service Worker 30s 回收后状态机幂等重水化 (Rehydration)
   * 从 chrome.storage.session + IndexedDB 恢复历史快照与流状态，无缝接续后续流
   */
  public restoreSession(params: {
    jobId: string;
    streamId: string;
    responseSnapshot: string;
    prompt?: string;
    url?: string;
  }): void {
    this.currentJobId = params.jobId;
    this.currentPrompt = params.prompt || '';
    this.activeStreamId = params.streamId;
    this.responseSnapshot = params.responseSnapshot || '';
    // D2 修复：先显式清空旧 parser，防止 url 缺省时旧 parser 残留导致后续帧错误路由
    this.activeParser = undefined;
    if (params.url) {
      this.activeParser = new UnifiedSemanticStreamParser(
        params.url,
        (event) => this.handleSemanticEvent(event),
        this.currentPrompt
      );
    }
    this.setState('STREAMING');
    this.refreshTtftTimer();
    this.options.onPauseDom?.();
  }

  public handleStreamFrame(frame: StreamFramePayload): void {
    const { streamId, url, rawText, isDone, status } = frame;

    // 1. 严格白名单门卫：非目标 GENERATION 请求归为 UNKNOWN
    const endpointType = matchGenerationEndpoint(url);
    if (endpointType === 'UNKNOWN') {
      // 契约：只记录日志，绝不汇总到 responseSnapshot，绝不抢占锁
      return;
    }

    // 2. 状态机流转与活跃流互斥锁 (Active Stream Lock)
    if (this.state === 'PENDING_STREAM') {
      // 成功捕获第一帧合规主会话流，立刻独占上锁并冻结 DOM 监听
      this.activeStreamId = streamId;
      this.activeParser = new UnifiedSemanticStreamParser(
        url,
        (event) => this.handleSemanticEvent(event),
        this.currentPrompt
      );
      this.setState('STREAMING');
      this.options.onPauseDom?.();
    }

    // 3. 互斥保护：非当前活跃流 ID 的后续数据一律丢弃，杜绝并发篡夺
    if (this.activeStreamId !== streamId) {
      return;
    }

    // 4. 将原始分片数据送入统一语义解析器
    if (this.activeParser && (rawText || isDone)) {
      this.activeParser.feedRawText(rawText, isDone);
    }

    // 5. 处理底层网络终态 (DONE / PARTIAL / ERROR)
    if (isDone) {
      this.clearTtftTimer();
      // 关键修复 (Defect 5): 释放锁前必须严格优先以物理网络真实状态裁决，杜绝提前为 null 漏判
      if (status === 'PARTIAL') {
        this.setState('PARTIAL');
      } else if (status === 'ERROR') {
        this.setState('ERROR');
      } else {
        this.setState('DONE');
      }
      this.activeStreamId = null;
    }
  }

  /**
   * 处理语义解析器派发的结构化语义事件
   */
  private handleSemanticEvent(event: SemanticEvent): void {
    switch (event.type) {
      case 'THINKING':
        // 深度思考心跳：刷新 15s TTFT 定时器，防止长思考误判超时
        this.refreshTtftTimer();
        this.options.onThinkingHeartbeat?.(event.text);
        break;

      case 'SNAPSHOT':
        // 全量快照模式：原子替换缓冲区
        this.responseSnapshot = event.text;
        this.options.onSnapshotUpdate?.(this.responseSnapshot);
        break;

      case 'DELTA':
        // 增量模式：累加缓冲区
        this.responseSnapshot += event.text;
        this.options.onSnapshotUpdate?.(this.responseSnapshot);
        break;

      case 'DONE':
        if (this.state === 'STREAMING') {
          this.clearTtftTimer();
          this.setState('DONE');
        }
        break;

      case 'PARTIAL':
        if (this.state === 'STREAMING') {
          this.clearTtftTimer();
          this.setState('PARTIAL');
        }
        break;

      case 'ERROR':
        this.clearTtftTimer();
        this.setState('ERROR');
        break;
    }
  }

  /**
   * 网络请求错误 (如 HTTP 4xx/5xx) 时触发安全网平滑降级
   */
  public handleNetworkError(statusCode: number): void {
    if (this.state === 'PENDING_STREAM' || this.state === 'STREAMING') {
      this.triggerDomFallback();
    }
  }

  private checkAndTriggerFallback(): void {
    if (this.state === 'PENDING_STREAM') {
      const hasDomContent = this.options.checkDomHasContent ? this.options.checkDomHasContent() : true;
      if (hasDomContent) {
        this.triggerDomFallback();
      }
    }
  }

  private triggerDomFallback(): void {
    this.clearTtftTimer();
    this.activeStreamId = null;
    this.setState('DOM_FALLBACK');
    this.options.onResumeDom?.();
  }

  private setState(newState: OrchestratorState): void {
    this.state = newState;
    this.options.onStateChange?.(newState);
  }

  private refreshTtftTimer(): void {
    this.clearTtftTimer();
    this.ttftTimer = setTimeout(() => {
      this.checkAndTriggerFallback();
    }, this.TTFT_TIMEOUT_MS) as unknown as number;
  }

  private clearTtftTimer(): void {
    if (this.ttftTimer !== null) {
      clearTimeout(this.ttftTimer);
      this.ttftTimer = null;
    }
  }

  public getState(): OrchestratorState {
    return this.state;
  }

  public getActiveStreamId(): string | null {
    return this.activeStreamId;
  }

  public getResponseSnapshot(): string {
    return this.responseSnapshot;
  }

  public reset(): void {
    this.clearTtftTimer();
    this.state = 'IDLE';
    this.currentJobId = null;
    this.activeStreamId = null;
    this.responseSnapshot = '';
    this.activeParser = undefined;
  }
}
