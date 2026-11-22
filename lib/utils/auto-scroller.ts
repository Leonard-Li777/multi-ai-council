/**
 * 通用回复内容区自动滚动工具
 * 解决各 AI 站点（ChatGPT / Qwen / Gemini / Claude / DeepSeek / Wenxin / ChatGLM）
 * 在回复超出视口或后台标签页时，因虚拟列表/懒渲染未滚动到底部导致视口外内容不渲染或停止拉取的问题。
 */

const EXCLUDED_ANCESTOR_SELECTOR =
  'nav, aside, form, textarea, pre, code, [contenteditable="true"], [class*="sidebar"], [class*="side-nav"], [class*="sidenav"], [class*="history-list"], [class*="conversation-list"]';

// 覆盖所有现代聊天站点的潜在滚动容器标签，彻底摆脱对特定 CSS 类名的依赖
// （先通过 scrollHeight > clientHeight + 20 做 O(1) 几何剪枝，仅对极少数真正溢出的节点调用 getComputedStyle）
const CONTAINER_TAG_SELECTOR = 'infinite-scroller, main, section, article, div';

function isExcludedElement(el: HTMLElement): boolean {
  const tag = el.tagName?.toLowerCase() || '';
  if (tag === 'nav' || tag === 'aside' || tag === 'form' || tag === 'textarea' || tag === 'pre' || tag === 'code') {
    return true;
  }
  const cls = (el.className || '').toString().toLowerCase();
  if (
    cls.includes('sidebar') ||
    cls.includes('side-nav') ||
    cls.includes('sidenav') ||
    cls.includes('history-list') ||
    cls.includes('conversation-list')
  ) {
    return true;
  }
  if (el.closest(EXCLUDED_ANCESTOR_SELECTOR) !== null) {
    return true;
  }
  // 在真实浏览器环境下，排除宽度过窄的侧边栏/抽屉容器（不影响 happy-dom 等无布局测试环境）
  if (typeof window !== 'undefined' && window.innerWidth > 480 && typeof el.getBoundingClientRect === 'function') {
    const rect = el.getBoundingClientRect();
    if (rect.width > 0 && rect.width < window.innerWidth * 0.3) {
      return true;
    }
  }
  return false;
}

function isScrollableElement(el: HTMLElement): boolean {
  if (!el) return false;
  const scrollHeight = el.scrollHeight || 0;
  const clientHeight = el.clientHeight || 0;
  if (scrollHeight <= clientHeight + 20) return false;

  // 根滚动元素直接允许
  if (el === document.documentElement || el === document.body || el === document.scrollingElement) {
    return true;
  }

  // 过矮的局部控件（如单行输入框、小代码框）不作为主回复滚动区
  if (clientHeight > 0 && clientHeight < 120) return false;

  // 自定义滚动组件（如 Gemini 的 infinite-scroller）直接放行
  if (el.tagName?.toLowerCase() === 'infinite-scroller') {
    return true;
  }

  try {
    const style = window.getComputedStyle(el);
    const overflowY = style?.overflowY || '';
    return overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
  } catch {
    return false;
  }
}

function collectScrollableCandidates(scope: HTMLElement, candidates: Set<HTMLElement>): void {
  if (!scope || typeof scope.querySelectorAll !== 'function') return;
  const nodes = scope.querySelectorAll<HTMLElement>(CONTAINER_TAG_SELECTOR);
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i]!;
    // 快速几何剪枝：绝大部分 div 没有垂直溢出，直接跳过，避免无谓的 getComputedStyle 与 closest 开销
    if ((el.scrollHeight || 0) <= (el.clientHeight || 0) + 20) continue;
    if ((el.clientHeight || 0) > 0 && (el.clientHeight || 0) < 120) continue;
    if (!isExcludedElement(el) && isScrollableElement(el)) {
      candidates.add(el);
    }
  }
}

/**
 * 智能定位当前站点最主要的回复内容区滚动容器
 */
export function findReplyScrollContainer(root?: HTMLElement | null): HTMLElement | null {
  if (typeof document === 'undefined') return null;

  const candidates = new Set<HTMLElement>();
  const baseRoot = root && root !== document.body ? root : document.querySelector<HTMLElement>('main') || document.body;

  // 1. 检查 root 自身及其向上祖先链路（处理外层 wrapper 滚动的站点，如 ChatGPT / Claude / Qwen 外层滚动区）
  let cur: HTMLElement | null = baseRoot;
  let depth = 0;
  while (cur && cur !== document.documentElement && depth < 10) {
    if (!isExcludedElement(cur) && isScrollableElement(cur)) {
      candidates.add(cur);
    }
    cur = cur.parentElement;
    depth++;
  }

  // 2. 全量几何扫描 baseRoot 内部真正可滚动的容器（彻底摆脱对 CSS 类名的依赖，兼容 DeepSeek/Qwen/ChatGPT 混淆类名与 Tailwind）
  if (baseRoot) {
    collectScrollableCandidates(baseRoot, candidates);
  }

  // 3. 若 baseRoot（如 main）内未找到，扩大至 document.body 兜底扫描（兼容主聊天区不在 <main> 内的站点）
  if (candidates.size === 0 && document.body && baseRoot !== document.body) {
    collectScrollableCandidates(document.body, candidates);
  }

  // 4. 在候选中挑选最具代表性的主对话滚动区（按可视面积与可滚动高度综合排序）
  if (candidates.size > 0) {
    let best: HTMLElement | null = null;
    let bestScore = -1;

    for (const el of candidates) {
      const area = (el.clientWidth || 1) * (el.clientHeight || 1);
      const scrollableDelta = Math.max(0, (el.scrollHeight || 0) - (el.clientHeight || 0));
      // 优先选择主视口大容器，同时兼顾实际内容溢出高度
      const score = area + scrollableDelta * 100;
      if (score > bestScore) {
        bestScore = score;
        best = el;
      }
    }
    if (best) return best;
  }

  // 5. 兜底：若页面本身为整页滚动，返回 document.scrollingElement
  const docScroller = (document.scrollingElement || document.documentElement) as HTMLElement | null;
  if (docScroller && isScrollableElement(docScroller)) {
    return docScroller;
  }

  return null;
}

function forceScrollElementToBottom(container: HTMLElement): boolean {
  const maxScrollTop = Math.max(0, (container.scrollHeight || 0) - (container.clientHeight || 0));
  const distanceFromBottom = maxScrollTop - (container.scrollTop || 0);

  // 已经贴底时无需重复触发，避免无谓重绘
  if (distanceFromBottom <= 16) {
    return false;
  }

  container.scrollTop = container.scrollHeight;
  if (typeof container.scrollTo === 'function') {
    try {
      container.scrollTo({ top: container.scrollHeight, behavior: 'auto' });
    } catch {
      // 某些测试环境或旧容器不支持 ScrollToOptions，已通过 scrollTop 赋值兜底
    }
  }

  // 主动派发 scroll 事件，唤醒依赖 scroll 监听或 IntersectionObserver 的虚拟列表框架
  try {
    container.dispatchEvent(new Event('scroll', { bubbles: false }));
  } catch {
    // ignore
  }

  return true;
}

/**
 * 将回复内容区平滑或直接滚动至底部，并主动派发 scroll 事件唤醒虚拟列表/懒渲染
 * @returns 是否实际执行了向下滚动
 */
export function scrollReplyContainerToBottom(root?: HTMLElement | null): boolean {
  try {
    let scrolled = false;
    const container = findReplyScrollContainer(root);
    if (container) {
      scrolled = forceScrollElementToBottom(container);
    }

    // 若整页滚动条也存在未贴底的溢出（例如部分站点同时有外层窗口滚动），一并拉到底部
    const docScroller = (document.scrollingElement || document.documentElement) as HTMLElement | null;
    if (docScroller && docScroller !== container && isScrollableElement(docScroller)) {
      if (forceScrollElementToBottom(docScroller)) {
        scrolled = true;
      }
    }

    return scrolled;
  } catch {
    return false;
  }
}
