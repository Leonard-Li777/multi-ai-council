import { createStreamTransformPipeline } from './stream-pipeline';
import type { StreamFramePayload } from '../types/interceptor';

export interface FetchProxyOptions {
  isTargetRequest: (url: string, method: string) => boolean;
  onFrame: (frame: StreamFramePayload) => void;
  onError?: (err: unknown) => void;
}

/**
 * 最佳努力提取请求体 (Best-Effort)
 * 严禁调用原 Request 的 text() 消费未克隆流；仅在 body 为 string 或可安全读取时提取特征
 */
export function extractRequestBodyBestEffort(input: RequestInfo | URL, init?: RequestInit): string | null {
  try {
    if (init && init.body) {
      if (typeof init.body === 'string') {
        return init.body;
      }
      if (init.body instanceof URLSearchParams) {
        return init.body.toString();
      }
      // FormData, Blob, ReadableStream 等流式对象不破坏性消费
      return null;
    }
    if (typeof input === 'object' && 'body' in input) {
      // input 是 Request 对象，避免直接读取 input.text() 消费流
      return null;
    }
  } catch {
    // 忽略异常，确保 0 阻断
  }
  return null;
}

/**
 * 设置 window.fetch 拦截代理
 * 使用 new Proxy 并在 window 上保留原有属性描述符
 */
export function setupFetchProxy(options: FetchProxyOptions): void {
  if (typeof window === 'undefined' || !window.fetch) {
    return;
  }

  const originalFetch = window.fetch;
  const originalDescriptor = Object.getOwnPropertyDescriptor(window, 'fetch') || {
    writable: true,
    enumerable: true,
    configurable: true,
  };

  const fetchProxy = new Proxy(originalFetch, {
    apply(target, thisArg, argArray) {
      const [input, init] = argArray as [RequestInfo | URL, RequestInit | undefined];

      let urlStr = '';
      if (typeof input === 'string') {
        urlStr = input;
      } else if (input instanceof URL) {
        urlStr = input.toString();
      } else if (input && typeof input === 'object' && 'url' in input) {
        urlStr = (input as Request).url;
      }

      let method = 'GET';
      if (init && init.method) {
        method = init.method.toUpperCase();
      } else if (input && typeof input === 'object' && 'method' in input) {
        method = ((input as Request).method || 'GET').toUpperCase();
      }

      const isTarget = options.isTargetRequest(urlStr, method);

      const promise = Reflect.apply(target, thisArg, argArray) as Promise<Response>;

      if (!isTarget) {
        return promise;
      }

      return promise.then((res: Response) => {
        // Fail-Open 绝对门禁：凡任何异常，无条件返回未篡改的原生 res，绝不击穿宿主请求
        try {
          // 门卫 1: 仅对存在未锁定 body 且非 Null-body 状态码（204, 205, 304）的响应介入
          const nullBodyStatuses = [204, 205, 304];
          if (!res.body || res.body.locked || nullBodyStatuses.includes(res.status)) {
            return res;
          }

          const streamId = `fetch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const pipeline = createStreamTransformPipeline({
            streamId,
            url: urlStr,
            method: 'FETCH',
            onFrame: options.onFrame,
            onError: options.onError,
          });

          const rawBody = res.body;
          const newBody = rawBody.pipeThrough(pipeline);

          // 使用 new Response 包装管道输出，并通过 Object.defineProperty 还原 url 等只读属性
          const proxiedResponse = new Response(newBody, {
            status: res.status,
            statusText: res.statusText,
            headers: res.headers,
          });

          try {
            Object.defineProperty(proxiedResponse, 'url', {
              value: res.url,
              writable: false,
              configurable: true,
            });
          } catch {
            // 降级忽略
          }

          return proxiedResponse;
        } catch (err) {
          // Fail-Open: 记录异常并安全回退原生响应
          if (options.onError) {
            options.onError(err);
          }
          return res;
        }
      });
    },
  });

  try {
    Object.defineProperty(window, 'fetch', {
      value: fetchProxy,
      writable: originalDescriptor.writable ?? true,
      enumerable: originalDescriptor.enumerable ?? true,
      configurable: originalDescriptor.configurable ?? true,
    });
  } catch (err) {
    // 若 defineProperty 受限，降级直接赋值
    window.fetch = fetchProxy;
  }
}
