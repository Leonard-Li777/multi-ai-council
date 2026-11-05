// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { extractRequestBodyBestEffort, setupFetchProxy } from '../lib/interceptor/fetch-proxy';

describe('AC-FAIL-OPEN & H-04: Fetch 代理安全门卫与请求体提取 (fetch-proxy)', () => {
  const originalFetch = window.fetch;

  beforeEach(() => {
    // 恢复 window 属性
    delete (window as any).__MULTI_AI_NETWORK_PROXY_INITIALIZED__;
  });

  afterEach(() => {
    window.fetch = originalFetch;
  });

  describe('extractRequestBodyBestEffort', () => {
    it('正确安全提取 string 类型的 body', () => {
      const body = JSON.stringify({ prompt: '你好' });
      expect(extractRequestBodyBestEffort('https://api.com', { body })).toBe(body);
    });

    it('正确安全提取 URLSearchParams 类型的 body', () => {
      const params = new URLSearchParams({ q: 'test' });
      expect(extractRequestBodyBestEffort('https://api.com', { body: params })).toBe('q=test');
    });

    it('对于 Request 对象或不可重读流式 body，安全返回 null 且 0 抛错', () => {
      const mockRequest = { url: 'https://api.com', body: {} } as any;
      expect(extractRequestBodyBestEffort(mockRequest)).toBeNull();
    });

    it('当发生任何异常时，Fail-Open 安全返回 null', () => {
      const badInit = {
        get body() {
          throw new Error('Access denied');
        },
      } as any;
      expect(extractRequestBodyBestEffort('https://api.com', badInit)).toBeNull();
    });
  });

  describe('C-01: Null-body 状态码 (204/304) 与异常下的 Fail-Open 绝对保护', () => {
    it('面对 204 No Content 响应时，绝不抛出 TypeError，原样返回原生响应', async () => {
      const mock204Response = new Response(null, { status: 204, statusText: 'No Content' });
      window.fetch = vi.fn().mockResolvedValue(mock204Response);

      const errorSpy = vi.fn();
      setupFetchProxy({
        isTargetRequest: () => true,
        onFrame: vi.fn(),
        onError: errorSpy,
      });

      const res = await window.fetch('https://chatgpt.com/backend-api/conversation', {
        method: 'POST',
      });

      expect(res.status).toBe(204);
      expect(res).toBe(mock204Response);
    });

    it('当 pipeThrough 或 new Response 构造抛出意外异常时，Fail-Open 返回原响应，0 击穿宿主', async () => {
      const mockBrokenResponse = {
        status: 200,
        statusText: 'OK',
        headers: new Headers(),
        url: 'https://chat.deepseek.com/api/v0/chat/completion',
        get body() {
          return {
            locked: false,
            pipeThrough() {
              throw new Error('Broken pipeline');
            },
          } as any;
        },
      } as any;

      window.fetch = vi.fn().mockResolvedValue(mockBrokenResponse);

      const errorSpy = vi.fn();
      setupFetchProxy({
        isTargetRequest: () => true,
        onFrame: vi.fn(),
        onError: errorSpy,
      });

      const res = await window.fetch('https://chat.deepseek.com/api/v0/chat/completion', {
        method: 'POST',
      });

      expect(res).toBe(mockBrokenResponse);
      expect(errorSpy).toHaveBeenCalled();
    });

    it('非 POST 请求或非目标 URL 绝不拦截', async () => {
      const mockGetResponse = new Response('ok', { status: 200 });
      window.fetch = vi.fn().mockResolvedValue(mockGetResponse);

      const frameSpy = vi.fn();
      setupFetchProxy({
        isTargetRequest: (url, method) => method === 'POST' && url.includes('chat'),
        onFrame: frameSpy,
      });

      // GET 请求
      const res = await window.fetch('https://chatgpt.com/backend-api/conversation', {
        method: 'GET',
      });
      expect(res).toBe(mockGetResponse);
      expect(frameSpy).not.toHaveBeenCalled();
    });
  });
});
