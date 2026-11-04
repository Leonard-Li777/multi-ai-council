/**
 * 将 AI 回复容器的 DOM 结构转为结构化 Markdown
 * 完整保留代码块、表格、公式、列表结构，杜绝 innerText 丢失排版
 */
export function domToMarkdown(root: HTMLElement): string {
  if (!root) return '';

  // 克隆节点防止污染原页面
  const clone = root.cloneNode(true) as HTMLElement;

  // 1. 移除不相干的控件元素（如复制按钮、点赞踩、折叠按钮等）
  const noiseSelectors = [
    'button',
    '.copy-button',
    '.action-bar',
    'svg',
    '[role="button"]',
    '.ds-icon',
    '.feedback-actions',
  ];
  noiseSelectors.forEach((sel) => {
    clone.querySelectorAll(sel).forEach((el) => el.remove());
  });

  return walkNode(clone).trim();
}

function walkNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent || '';
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return '';
  }

  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();

  // 代码块优先处理
  if (tag === 'pre') {
    const codeEl = el.querySelector('code');
    const lang = codeEl?.className?.match(/language-([a-zA-Z0-9_-]+)/)?.[1] || '';
    const codeText = codeEl ? codeEl.textContent : el.textContent;
    return `\n\`\`\`${lang}\n${(codeText || '').trim()}\n\`\`\`\n`;
  }

  if (tag === 'code' && el.parentElement?.tagName.toLowerCase() !== 'pre') {
    return `\`${el.textContent || ''}\``;
  }

  // 标题
  if (/^h[1-6]$/.test(tag)) {
    const level = parseInt(tag[1] || '1', 10);
    const prefix = '#'.repeat(level);
    return `\n${prefix} ${getTextContent(el).trim()}\n\n`;
  }

  // 段落
  if (tag === 'p') {
    return `\n${walkChildren(el).trim()}\n\n`;
  }

  // 换行
  if (tag === 'br') {
    return '\n';
  }

  // 粗体/强调
  if (tag === 'strong' || tag === 'b') {
    return `**${walkChildren(el).trim()}**`;
  }

  if (tag === 'em' || tag === 'i') {
    return `*${walkChildren(el).trim()}*`;
  }

  // 列表
  if (tag === 'ul') {
    return '\n' + walkList(el, false) + '\n';
  }

  if (tag === 'ol') {
    return '\n' + walkList(el, true) + '\n';
  }

  // 表格
  if (tag === 'table') {
    return '\n' + parseTable(el) + '\n';
  }

  // 引用
  if (tag === 'blockquote') {
    const inner = walkChildren(el).trim();
    return (
      '\n' +
      inner
        .split('\n')
        .map((line) => `> ${line}`)
        .join('\n') +
      '\n\n'
    );
  }

  // 默认递归子节点
  return walkChildren(el);
}

function walkChildren(el: HTMLElement): string {
  let result = '';
  for (const child of Array.from(el.childNodes)) {
    result += walkNode(child);
  }
  return result;
}

function walkList(listEl: HTMLElement, isOrdered: boolean): string {
  let result = '';
  let index = 1;
  const items = listEl.querySelectorAll(':scope > li');
  items.forEach((li) => {
    const prefix = isOrdered ? `${index++}. ` : '- ';
    result += `${prefix}${walkChildren(li as HTMLElement).trim()}\n`;
  });
  return result;
}

function parseTable(tableEl: HTMLElement): string {
  const rows = Array.from(tableEl.querySelectorAll('tr'));
  if (rows.length === 0) return '';

  let md = '';
  rows.forEach((tr, index) => {
    const cells = Array.from(tr.querySelectorAll('th, td')).map((cell) =>
      cell.textContent?.trim().replace(/\|/g, '\\|') || ''
    );
    md += `| ${cells.join(' | ')} |\n`;

    // 表头分割线
    if (index === 0) {
      const sep = cells.map(() => '---').join(' | ');
      md += `| ${sep} |\n`;
    }
  });

  return md;
}

function getTextContent(el: HTMLElement): string {
  return el.textContent || '';
}
