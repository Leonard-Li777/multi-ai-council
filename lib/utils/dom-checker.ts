/**
 * 严格检查页面中是否包含真实的登录按钮（坚决排除“退出登录”、“切换账号”、“登录记录”等已登录状态的按钮）
 */
export function isLoginButtonPresent(selector = 'button, a, div[role="button"], span'): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const elements = document.querySelectorAll(selector);
    for (let i = 0; i < elements.length; i++) {
      const rawText = elements[i]?.textContent?.trim() || '';
      const text = rawText.toLowerCase();

      // 坚决排除“退出登录”、“切换账号”、“登录记录”等登出或设置按钮
      if (
        text.includes('退出') ||
        text.includes('登出') ||
        text.includes('sign out') ||
        text.includes('log out') ||
        text.includes('logout') ||
        text.includes('已登录') ||
        text.includes('切换') ||
        text.includes('设备')
      ) {
        continue;
      }

      // 精确或高置信度登录词匹配
      if (
        text === '登录' ||
        text === '登 录' ||
        text === '立即登录' ||
        text === '去登录' ||
        text === 'sign in' ||
        text === 'log in' ||
        text === 'login' ||
        text === '登录/注册' ||
        text === '注册/登录'
      ) {
        return true;
      }
    }
  } catch {}
  return false;
}

/**
 * 安全检查 DOM 中是否包含匹配关键词的元素
 */
export function hasElementWithText(
  selector: string,
  keywords: string[],
  excludeKeywords: string[] = ['退出', '登出', 'sign out', 'log out']
): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const elements = document.querySelectorAll(selector);
    for (let i = 0; i < elements.length; i++) {
      const text = elements[i]?.textContent?.trim().toLowerCase() || '';
      if (excludeKeywords.some((ex) => text.includes(ex.toLowerCase()))) {
        continue;
      }
      for (const kw of keywords) {
        if (text === kw.toLowerCase() || (text.length <= 10 && text.includes(kw.toLowerCase()))) {
          return true;
        }
      }
    }
  } catch {
    // 忽略非法选择器语法异常，防止崩溃
  }
  return false;
}
