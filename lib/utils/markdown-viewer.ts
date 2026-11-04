import DOMPurify from 'dompurify';
import type { ReviewJob, SupportedSite } from '../types/review-job';

/**
 * 使用 DOMPurify 安全清洗 Markdown / HTML 字符串，杜绝 XSS
 */
export function sanitizeHtml(html: string): string {
  if (typeof window === 'undefined') {
    // Node.js 测试环境下的安全降级清洗
    return html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
      .replace(/on\w+="[^"]*"/gi, '')
      .replace(/on\w+='[^']*'/gi, '')
      .replace(/on\w+=\S+/gi, '');
  }
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'p', 'br', 'hr',
      'ul', 'ol', 'li',
      'b', 'strong', 'i', 'em', 'code', 'pre',
      'blockquote', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
      'span', 'div', 'mark',
    ],
    ALLOWED_ATTR: ['class', 'id', 'name', 'title'],
  });
}

/**
 * 在文本中将 Model A~E 替换/补充为真实模型名称
 */
export function revealModelIdentities(
  text: string,
  anonymousMap: Record<string, SupportedSite>
): string {
  if (!text || !anonymousMap) return text;
  let revealed = text;
  for (const [label, site] of Object.entries(anonymousMap)) {
    // 匹配 Model A，若紧跟 '(' 则视为已被补充，不再重复替换
    const regex = new RegExp(`\\b${label}\\b(?!\\s*\\()`, 'g');
    revealed = revealed.replace(regex, `${label} (${site})`);
  }
  return revealed;
}

/**
 * 触发浏览器本地文件下载
 */
function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * 导出任务快照为 JSON
 */
export function exportJobAsJson(job: ReviewJob) {
  const data = JSON.stringify(job, null, 2);
  const dateStr = new Date(job.createdAt).toISOString().slice(0, 10);
  downloadFile(data, `multi-ai-council-${dateStr}-${job.id.slice(0, 8)}.json`, 'application/json');
}

/**
 * 导出终审报告为 Markdown
 */
export function exportReportAsMarkdown(job: ReviewJob, revealed = true) {
  const dateStr = new Date(job.createdAt).toLocaleString();
  let content = `# Multi-AI Council 终审聚合报告\n\n`;
  content += `- **任务 ID**: \`${job.id}\`\n`;
  content += `- **生成时间**: ${dateStr}\n`;
  content += `- **原始提示词**: ${job.originalPrompt}\n\n`;

  if (job.synthesisRun?.anonymousMap) {
    content += `### 模型匿名对照表\n`;
    for (const [label, site] of Object.entries(job.synthesisRun.anonymousMap)) {
      content += `- **${label}**: ${site}\n`;
    }
    content += `\n---\n\n`;
  }

  const rawReport = job.synthesisRun?.finalMarkdown || '（终审报告未生成）';
  const finalContent = revealed && job.synthesisRun?.anonymousMap
    ? revealModelIdentities(rawReport, job.synthesisRun.anonymousMap)
    : rawReport;

  content += `## 终审提炼结果\n\n${finalContent}\n\n---\n\n`;

  content += `## 各模型原始回复记录\n\n`;
  for (const [site, run] of Object.entries(job.providerRuns)) {
    content += `### ${site} (${run.status})\n\n`;
    content += run.cleanedResponse || run.responseSnapshot || '（无回复）';
    content += `\n\n`;
  }

  downloadFile(content, `multi-ai-report-${job.id.slice(0, 8)}.md`, 'text/markdown');
}
