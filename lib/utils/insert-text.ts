export interface SimulateTextInputOptions {
  autoSubmit?: boolean;
}

/**
 * 健壮的富文本输入模拟工具
 * 支持普通 textarea 与 ProseMirror/Lexical/Quill 等 contenteditable 受控组件
 */
export async function simulateTextInput(
  element: HTMLElement,
  text: string,
  options?: SimulateTextInputOptions
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

    if (options?.autoSubmit) {
      const form = element.closest('form');
      if (form && typeof form.requestSubmit === 'function') {
        form.requestSubmit();
      }
    }
    return true;
  }

  // 若为 contenteditable 富文本 (ProseMirror / Lexical / Quill / 百度富文本等)
  // 1. 定位真实的可编辑节点（处理外层 wrapper 场景）
  let target: HTMLElement = element;
  if (target.getAttribute('contenteditable') !== 'true') {
    const innerEditable = target.querySelector<HTMLElement>('[contenteditable="true"]');
    if (innerEditable) {
      target = innerEditable;
    }
  }

  target.focus();

  // 2. 特殊处理：如果是 Gemini Quill 编辑器 (div.ql-editor)
  const qlEditor = target.classList.contains('ql-editor') ? target : target.closest('.ql-editor');
  if (qlEditor) {
    qlEditor.innerHTML = `<p>${text}</p>`;
    qlEditor.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    return true;
  }

  // 辅助检测函数：验证编辑器是否已包含目标文本（排除空或纯占位符）
  const isContentInjected = (el: HTMLElement, expected: string): boolean => {
    const val = (el.innerText || el.textContent || '').trim();
    if (val.length === 0) return false;
    const lead = expected.trim().slice(0, 15);
    return val.includes(lead) || val.length >= Math.min(20, expected.trim().length);
  };

  // 3. 优先通道：模拟真实 ClipboardEvent ('paste')
  // 现代富文本（ProseMirror / Lexical / Draft.js）以 paste 作为处理多行格式的最佳管道
  try {
    const selection = window.getSelection();
    let p = target.querySelector('p');
    if (!p) {
      p = document.createElement('p');
      target.appendChild(p);
    }
    const range = document.createRange();
    range.selectNodeContents(p);
    range.collapse(false);
    selection?.removeAllRanges();
    selection?.addRange(range);

    const dataTransfer = new DataTransfer();
    dataTransfer.setData('text/plain', text);
    const pasteEvent = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      composed: true,
      clipboardData: dataTransfer,
    });
    target.dispatchEvent(pasteEvent);
    target.dispatchEvent(new Event('input', { bubbles: true, composed: true }));

    if (isContentInjected(target, text)) {
      return true;
    }
  } catch (err) {
    console.warn('[simulateTextInput] paste event simulation failed', err);
  }

  // 4. 次选通道：document.execCommand('insertText') 原生命令
  if (typeof document.execCommand === 'function') {
    try {
      const selection = window.getSelection();
      let p = target.querySelector('p') || target;
      const range = document.createRange();
      range.selectNodeContents(p);
      range.collapse(false);
      selection?.removeAllRanges();
      selection?.addRange(range);

      target.dispatchEvent(
        new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: text })
      );
      const success = document.execCommand('insertText', false, text);
      target.dispatchEvent(
        new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: text })
      );

      if (success && isContentInjected(target, text)) {
        return true;
      }
    } catch (err) {
      console.warn('[simulateTextInput] execCommand failed, fallback to structured DOM', err);
    }
  }

  // 5. 保底通道：构建符合 ProseMirror/HTML 规范的结构化段落（严禁直接 target.innerText 破坏 DOM 树）
  try {
    target.innerHTML = '';
    const lines = text.split('\n');
    lines.forEach((line) => {
      const p = document.createElement('p');
      p.setAttribute('dir', 'auto');
      if (line.length === 0) {
        const br = document.createElement('br');
        br.className = 'ProseMirror-trailingBreak';
        p.appendChild(br);
      } else {
        p.appendChild(document.createTextNode(line));
      }
      target.appendChild(p);
    });

    target.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        composed: true,
        inputType: 'insertText',
        data: text,
      })
    );
    target.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        composed: true,
        inputType: 'insertText',
        data: text,
      })
    );
    target.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    target.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

    return (target.textContent || '').trim().length > 0;
  } catch (err) {
    console.warn('[simulateTextInput] structured DOM fallback failed', err);
  }

  return (target.textContent || '').trim().length > 0;
}
