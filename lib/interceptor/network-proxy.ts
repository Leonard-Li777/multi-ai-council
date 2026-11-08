import { setupFetchProxy } from './fetch-proxy';
import { XhrProxyHandler } from './xhr-proxy';
import type { StreamFramePayload, InterceptorMessage } from '../types/interceptor';

/**
 * 严格判定是否为目标 AI 流式应答请求 (URL + POST 双重校验)
 */
export function isAiStreamRequest(url: string, method: string): boolean {
  if (!url || !method) return false;
  if (method.toUpperCase() !== 'POST') return false;

  // ChatGPT
  if (url.includes('/backend-api/conversation')) return true;
  // DeepSeek
  if (url.includes('/api/v0/chat/completion')) return true;
  // Claude
  if (url.includes('/api/organizations')) return true;
  // 通义千问 (收紧规则: 必须包含 /api/ 且包含 chat)
  if (url.includes('/api/') && url.includes('chat')) return true;
  // 百度文心一言 (广泛兼容各类聊天生成接口)
  if (
    (url.includes('baidu.com') || url.includes('yiyan') || url.includes('wenxin')) &&
    (url.includes('/conversation') || url.includes('/chat') || url.includes('/query'))
  ) return true;
  // Google Gemini RPC
  if (url.includes('StreamGenerate') || url.includes('assistant.lamda')) return true;

  return false;
}

/**
 * 增量合并与节流派发器 (50ms 聚合窗口内按 streamId 合并文本，消灭 IPC 洪峰)
 */
export class BatchedFrameDispatcher {
  private pendingStreams = new Map<string, StreamFramePayload>();
  private timer: number | null = null;
  private readonly THROTTLE_MS = 50;

  public dispatch(frame: StreamFramePayload): void {
    const { streamId, isDone } = frame;

    // 若收到终态帧 (isDone: true)，先合并此前积攒的文本并随终态或立即无延迟刷新
    if (isDone) {
      const existing = this.pendingStreams.get(streamId);
      if (existing) {
        // 先将此前积攒的流式增量合并发出去，再发终态
        this.emitPostMessage(existing);
        this.pendingStreams.delete(streamId);
      }
      this.emitPostMessage(frame);
      return;
    }

    // 针对常规流式增量：在 50ms 窗口内合并 rawText
    const existing = this.pendingStreams.get(streamId);
    if (existing) {
      existing.rawText += frame.rawText;
      existing.sequence = frame.sequence;
      existing.timestamp = frame.timestamp;
    } else {
      this.pendingStreams.set(streamId, { ...frame });
    }

    if (!this.timer) {
      this.timer = window.setTimeout(() => {
        this.flush();
      }, this.THROTTLE_MS);
    }
  }

  public flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pendingStreams.size === 0) return;

    for (const [, frame] of this.pendingStreams) {
      this.emitPostMessage(frame);
    }
    this.pendingStreams.clear();
  }

  private emitPostMessage(frame: StreamFramePayload): void {
    if (typeof window === 'undefined') return;
    const message: InterceptorMessage = {
      type: '__MULTI_AI_STREAM_FRAME__',
      payload: frame,
    };
    const targetOrigin = window.location.origin;
    window.postMessage(message, targetOrigin);
  }
}

declare global {
  interface Window {
    __MULTI_AI_NETWORK_PROXY_INITIALIZED__?: boolean;
  }
}

/**
 * 在 MAIN World 中初始化透明网络代理 (具备严格幂等保护)
 */
export function setupNetworkProxy(): void {
  if (typeof window === 'undefined') return;
  if (window.__MULTI_AI_NETWORK_PROXY_INITIALIZED__) {
    return;
  }
  window.__MULTI_AI_NETWORK_PROXY_INITIALIZED__ = true;

  const dispatcher = new BatchedFrameDispatcher();

  // 1. 初始化 Fetch 代理
  setupFetchProxy({
    isTargetRequest: isAiStreamRequest,
    onFrame: (frame) => dispatcher.dispatch(frame),
    onError: (err) => console.warn('[NetworkProxy] Fetch intercept error (fail-open):', err),
  });

  // 2. 初始化 XHR 原型代理
  const xhrHandler = new XhrProxyHandler({
    onFrame: (frame) => dispatcher.dispatch(frame),
    onError: (err) => console.warn('[NetworkProxy] XHR intercept error (fail-open):', err),
  });

  const originalOpen = XMLHttpRequest.prototype.open;
  const originalSend = XMLHttpRequest.prototype.send;

  XMLHttpRequest.prototype.open = function (
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null
  ) {
    const urlStr = typeof url === 'string' ? url : url.toString();
    const isTarget = isAiStreamRequest(urlStr, method);

    if (isTarget) {
      this.addEventListener('progress', () => {
        xhrHandler.handleProgress(this, urlStr);
      });
      this.addEventListener('readystatechange', () => {
        xhrHandler.handleReadyStateChange(this, urlStr);
      });
      this.addEventListener('abort', () => {
        xhrHandler.flushDelta(this, urlStr, true, 'PAGE_ABORT');
      });
      this.addEventListener('error', () => {
        xhrHandler.flushDelta(this, urlStr, true, 'PARSER_ERROR');
      });
    }
    return originalOpen.apply(this, [method, url, async ?? true, username, password] as any);
  };

  XMLHttpRequest.prototype.send = function (body?: Document | XMLHttpRequestBodyInit | null) {
    return originalSend.apply(this, [body] as any);
  };
}
