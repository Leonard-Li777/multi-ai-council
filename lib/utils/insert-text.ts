/**
 * 健壮的富文本输入模拟工具
 * 支持普通 textarea 与 ProseMirror/Lexical 等 contenteditable 受控组件
 */
export async function simulateTextInput(
  element: HTMLElement,
  text: string
): Promise<boolean> {
  element.focus();

  // 若为 textarea 或 input 元素
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    element.value = text;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  // 若为 contenteditable 富文本
  try {
    // 1. 全选已有内容以备覆写
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection?.removeAllRanges();
    selection?.addRange(range);

    // 2. 优先尝试 document.execCommand('insertText')
    const success = document.execCommand('insertText', false, text);
    if (success && element.innerText.trim().length > 0) {
      element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      return true;
    }
  } catch (err) {
    console.warn('[simulateTextInput] execCommand failed, fallback to paste event', err);
  }

  // 3. 降级：构造 ClipboardEvent ('paste')
  try {
    const dataTransfer = new DataTransfer();
    dataTransfer.setData('text/plain', text);
    const pasteEvent = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: dataTransfer,
    });
    element.dispatchEvent(pasteEvent);

    // 补充触发 input 与 keyup
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }));
    return element.innerText.trim().length > 0;
  } catch (err) {
    console.error('[simulateTextInput] paste event failed', err);
    // 最后的底层写入
    element.innerText = text;
    element.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
}
