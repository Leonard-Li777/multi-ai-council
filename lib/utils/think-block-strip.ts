/**
 * 剥离 DeepSeek / Qwen 等模型的深度思考 (<think>...</think>) 区块
 * 同时兼顾已闭合与流式进行中未闭合的标签
 */
export function stripThinkBlocks(rawText: string): { cleaned: string; thinkContent: string } {
  if (!rawText) {
    return { cleaned: '', thinkContent: '' };
  }

  let thinkContent = '';

  // 1. 匹配完整闭合的 <think>...</think>
  const closedRegex = /<think>([\s\S]*?)<\/think>/gi;
  let match: RegExpExecArray | null;
  while ((match = closedRegex.exec(rawText)) !== null) {
    thinkContent += match[1] + '\n';
  }

  let cleaned = rawText.replace(closedRegex, '').trim();

  // 2. 匹配正在流式输出中尚未闭合的 <think>... 尾部
  const unclosedRegex = /<think>([\s\S]*)$/i;
  const unclosedMatch = unclosedRegex.exec(cleaned);
  if (unclosedMatch) {
    thinkContent += unclosedMatch[1];
    cleaned = cleaned.replace(unclosedRegex, '').trim();
  }

  // 3. 针对部分站点自定义的 class 如 .think-container 或折叠面板
  cleaned = cleaned.replace(/【思考过程】[\s\S]*?【思考结束】/gi, '').trim();

  // 4. 清除类似“已经完成思考”、“Thought for x seconds”等独立思考头部标记与折叠栏
  cleaned = cleaned.replace(/^(>|\*|#|\s)*(已经完成思考|思考完成|思考完毕|思考中\.\.\.|已深度思考[^\n]*|Thought for \d+ seconds?)\s*/i, '').trim();

  // 5. 核心兜底：若经过剥离后，剩余内容仅为思考占位词（如“已经完成思考”或“思考过程”），直接将 cleaned 彻底置空
  const normalized = cleaned.trim().toLowerCase().replace(/[\s\.\:\…\-\_\,\，\。\(\)\（\）\【\】\[\]\>\#\*]/g, '');
  if (
    normalized === '已经完成思考' ||
    normalized === '已完成思考' ||
    normalized === '思考完成' ||
    normalized === '思考中' ||
    normalized === '正在思考' ||
    normalized === '深度思考中' ||
    normalized === '思考过程' ||
    normalized === 'thinking' ||
    normalized === 'thought' ||
    (normalized.includes('完成思考') && normalized.length <= 35) ||
    (normalized.includes('深度思考') && normalized.length <= 40) ||
    (normalized.includes('思考') && normalized.length <= 35) ||
    (normalized.includes('用时') && normalized.length <= 35)
  ) {
    cleaned = '';
  }

  return {
    cleaned,
    thinkContent: thinkContent.trim(),
  };
}
