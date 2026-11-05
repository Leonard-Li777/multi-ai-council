// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { simulateTextInput } from '../lib/utils/insert-text';

describe('AC-INPUT: 文本输入叩门与富文本编辑器写入 (simulateTextInput)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('在标准 textarea 中通过原型 Setter 正确填入并触发 input/change 事件与 autoSubmit', async () => {
    const form = document.createElement('form');
    form.requestSubmit = vi.fn();
    const textarea = document.createElement('textarea');
    form.appendChild(textarea);
    document.body.appendChild(form);

    const inputListener = vi.fn();
    const changeListener = vi.fn();
    textarea.addEventListener('input', inputListener);
    textarea.addEventListener('change', changeListener);

    const success = await simulateTextInput(textarea, 'Hello Multi-AI', { autoSubmit: true });
    expect(success).toBe(true);
    expect(textarea.value).toBe('Hello Multi-AI');
    expect(inputListener).toHaveBeenCalled();
    expect(changeListener).toHaveBeenCalled();
    expect(form.requestSubmit).toHaveBeenCalled();
  });

  it('在 contenteditable 富文本 div 中能够注入并触发 input 事件', async () => {
    // 模拟 document.execCommand 存在
    document.execCommand = vi.fn((command, showUI, value) => {
      if (command === 'insertText') {
        const active = document.activeElement as HTMLElement;
        if (active) active.textContent = value as string;
        return true;
      }
      return false;
    });

    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    document.body.appendChild(editor);

    const inputListener = vi.fn();
    editor.addEventListener('input', inputListener);

    const success = await simulateTextInput(editor, 'ProseMirror content');
    expect(success).toBe(true);
    expect(editor.textContent).toContain('ProseMirror content');
    expect(inputListener).toHaveBeenCalled();
    expect(document.execCommand).toHaveBeenCalledWith('insertText', false, 'ProseMirror content');
  });
});
