/**
 * 安全检查 DOM 中是否包含匹配关键词的元素（替代标准 querySelector 不支持的非标准 :has-text 伪类）
 */
export function hasElementWithText(selector: string, keywords: string[]): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const elements = document.querySelectorAll(selector);
    for (let i = 0; i < elements.length; i++) {
      const text = elements[i]?.textContent?.trim().toLowerCase() || '';
      for (const kw of keywords) {
        if (text.includes(kw.toLowerCase())) {
          return true;
        }
      }
    }
  } catch {
    // 忽略非法选择器语法异常，防止崩溃
  }
  return false;
}
