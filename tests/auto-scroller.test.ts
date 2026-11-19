// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import { findReplyScrollContainer, scrollReplyContainerToBottom } from '../lib/utils/auto-scroller';

function mockScrollMetrics(
  el: HTMLElement,
  metrics: { scrollHeight: number; clientHeight: number; clientWidth?: number; scrollTop?: number }
) {
  Object.defineProperty(el, 'scrollHeight', { value: metrics.scrollHeight, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: metrics.clientHeight, configurable: true });
  Object.defineProperty(el, 'clientWidth', { value: metrics.clientWidth ?? 800, configurable: true });
  let top = metrics.scrollTop ?? 0;
  Object.defineProperty(el, 'scrollTop', {
    get: () => top,
    set: (v: number) => {
      top = v;
    },
    configurable: true,
  });
}

describe('AutoScroller 通用回复内容区自动滚动工具', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('能精准识别主回复滚动区并排除侧边栏与输入框，执行滚动并派发 scroll 事件', () => {
    document.body.innerHTML = `
      <aside class="sidebar" style="overflow-y: auto;"></aside>
      <main>
        <div class="chat-scroll-container" style="overflow-y: auto;">
          <pre style="overflow-y: auto;">code block</pre>
        </div>
        <form><textarea style="overflow-y: auto;"></textarea></form>
      </main>
    `;

    const sidebar = document.querySelector<HTMLElement>('aside.sidebar')!;
    const main = document.querySelector<HTMLElement>('main')!;
    const chatScroll = document.querySelector<HTMLElement>('.chat-scroll-container')!;
    const codeBlock = document.querySelector<HTMLElement>('pre')!;
    const textarea = document.querySelector<HTMLElement>('textarea')!;

    mockScrollMetrics(sidebar, { scrollHeight: 5000, clientHeight: 800, clientWidth: 260, scrollTop: 0 });
    mockScrollMetrics(chatScroll, { scrollHeight: 3200, clientHeight: 700, clientWidth: 900, scrollTop: 100 });
    mockScrollMetrics(codeBlock, { scrollHeight: 1500, clientHeight: 300, clientWidth: 700, scrollTop: 0 });
    mockScrollMetrics(textarea, { scrollHeight: 500, clientHeight: 150, clientWidth: 700, scrollTop: 0 });

    const found = findReplyScrollContainer(main);
    expect(found).toBe(chatScroll);

    let scrollEventFired = false;
    chatScroll.addEventListener('scroll', () => {
      scrollEventFired = true;
    });

    const didScroll = scrollReplyContainerToBottom(main);
    expect(didScroll).toBe(true);
    expect(chatScroll.scrollTop).toBe(3200);
    expect(scrollEventFired).toBe(true);

    // 已经贴底时再次调用应返回 false，避免无谓重绘
    const didScrollAgain = scrollReplyContainerToBottom(main);
    expect(didScrollAgain).toBe(false);
  });

  it('能直接识别 Gemini 的 infinite-scroller 自定义滚动容器', () => {
    document.body.innerHTML = `
      <main>
        <infinite-scroller class="chat-history"></infinite-scroller>
      </main>
    `;

    const main = document.querySelector<HTMLElement>('main')!;
    const scroller = document.querySelector<HTMLElement>('infinite-scroller')!;
    mockScrollMetrics(scroller, { scrollHeight: 2400, clientHeight: 600, clientWidth: 850, scrollTop: 0 });

    expect(findReplyScrollContainer(main)).toBe(scroller);
    expect(scrollReplyContainerToBottom(main)).toBe(true);
    expect(scroller.scrollTop).toBe(2400);
  });
});
