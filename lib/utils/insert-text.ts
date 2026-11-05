/**
 * 健壮的富文本输入模拟工具
 * 支持普通 textarea 与 ProseMirror/Lexical/Quill 等 contenteditable 受控组件
 */
export async function simulateTextInput(
  element: HTMLElement,
  text: string
): Promise<boolean> {
  element.focus();

  // 若为 textarea 或 input 元素：通过原型 Setter 绕过 React/Vue 的值劫持，确保受控组件 onChange 触发
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const valueSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (valueSetter) {
      valueSetter.call(element, text);
    } else {
      element.value = text;
    }
    // 派发 beforeinput, input 与 change 事件激活状态监听与发送按钮
    element.dispatchEvent(
      new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: text })
    );
    element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    return true;
  }

  // 若为 contenteditable 富文本 (ProseMirror / Lexical / Quill / 百度富文本等)
  try {
    // 1. 全选已有内容以备覆写
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection?.removeAllRanges();
    selection?.addRange(range);

    // 2. 派发 beforeinput 事件
    element.dispatchEvent(
      new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: text })
    );

    // 3. 优先尝试 document.execCommand('insertText')，原生驱动内部编辑器状态
    const success = document.execCommand('insertText', false, text);
    element.dispatchEvent(
      new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: text })
    );

    if (success && (element.textContent || '').trim().length > 0) {
      return true;
    }
  } catch (err) {
    console.warn('[simulateTextInput] execCommand failed, fallback to paste event', err);
  }

  // 4. 降级：构造 ClipboardEvent ('paste')
  try {
    const dataTransfer = new DataTransfer();
    dataTransfer.setData('text/plain', text);
    const pasteEvent = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      composed: true,
      clipboardData: dataTransfer,
    });
    element.dispatchEvent(pasteEvent);
    element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    element.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'a' }));
    if ((element.textContent || '').trim().length > 0) {
      return true;
    }
  } catch (err) {
    console.warn('[simulateTextInput] paste event failed', err);
  }

  // 5. 特殊处理：如果是 Gemini Quill 编辑器 (div.ql-editor)
  const qlEditor = element.classList.contains('ql-editor') ? element : element.closest('.ql-editor');
  if (qlEditor) {
    qlEditor.innerHTML = `<p>${text}</p>`;
    qlEditor.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    return true;
  }

  // 6. 最后的底层写入保底
  element.innerText = text;
  element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  return (element.textContent || '').trim().length > 0;
}
