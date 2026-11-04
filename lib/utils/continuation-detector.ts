/**
 * 会话延伸判定器
 * 结合【规则引力集】与【Intl.Segmenter 分词重叠系数】
 */

// 强延续规则引力集正则
const CONTINUATION_REGEX =
  /^(继续|展开|深入|为什么|如何理解|怎么看|上述|前面|这[个种点项]|第[一二三四五六七八九十\d][个点条项]|优化|修改|重构|总结一下|再说说)/i;

// 常见停用词
const STOP_WORDS = new Set([
  '的', '了', '和', '是', '就', '都', '而', '及', '与', '着',
  '或', '一个', '没有', '我们', '你们', '他们', '这个', '那个',
  'a', 'an', 'the', 'and', 'or', 'is', 'in', 'at', 'of', 'to'
]);

export interface ContinuationResult {
  isContinuation: boolean;
  confidence: number;
  reason: 'RULE_GRAVITY' | 'OVERLAP_SCORE' | 'NEW_TOPIC';
}

/**
 * 分词并过滤停用词与标点
 */
export function tokenize(text: string): string[] {
  if (!text) return [];

  // 使用浏览器内置的国际化分词器
  const segmenter = new Intl.Segmenter('zh', { granularity: 'word' });
  const segments = segmenter.segment(text);
  const tokens: string[] = [];

  for (const seg of segments) {
    if (seg.isWordLike) {
      const word = seg.segment.trim().toLowerCase();
      if (word.length > 0 && !STOP_WORDS.has(word)) {
        tokens.push(word);
      }
    }
  }

  return tokens;
}

/**
 * 计算两个分词集合的重叠系数 (Overlap Coefficient)
 * |A ∩ B| / min(|A|, |B|)
 * 适合长短文本对比，尤其短追问（如“展开第三点”）不会因分母过大而被稀释成 0
 */
export function calculateOverlapCoefficient(tokensA: string[], tokensB: string[]): number {
  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  const setA = new Set(tokensA);
  const setB = new Set(tokensB);

  let intersectionCount = 0;
  for (const item of setA) {
    if (setB.has(item)) {
      intersectionCount++;
    }
  }

  const minLen = Math.min(setA.size, setB.size);
  return minLen === 0 ? 0 : intersectionCount / minLen;
}

/**
 * 判定当前提示词是否属于前序会话的延伸
 */
export function detectContinuation(
  newPrompt: string,
  lastPrompt: string,
  threshold = 0.35
): ContinuationResult {
  const trimmed = newPrompt.trim();
  if (!trimmed) {
    return { isContinuation: false, confidence: 0, reason: 'NEW_TOPIC' };
  }

  // 1. 引力集优先检测
  if (CONTINUATION_REGEX.test(trimmed)) {
    return {
      isContinuation: true,
      confidence: 0.95,
      reason: 'RULE_GRAVITY',
    };
  }

  // 若没有上一轮提示词，直接判为新话题
  if (!lastPrompt || !lastPrompt.trim()) {
    return { isContinuation: false, confidence: 0, reason: 'NEW_TOPIC' };
  }

  // 2. 基于分词重叠系数比对
  const currentTokens = tokenize(trimmed);
  const lastTokens = tokenize(lastPrompt);
  const score = calculateOverlapCoefficient(currentTokens, lastTokens);

  if (score >= threshold) {
    return {
      isContinuation: true,
      confidence: Math.min(score, 1),
      reason: 'OVERLAP_SCORE',
    };
  }

  return {
    isContinuation: false,
    confidence: score,
    reason: 'NEW_TOPIC',
  };
}
