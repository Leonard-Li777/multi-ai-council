export interface GeminiParseOptions {
  userPrompt?: string;
}

export interface GeminiParseResult {
  text: string;
  isDone: boolean;
}

/**
 * Google Gemini Batchexecute RPC 文本流解包器
 * 严格支持：
 * 1. 剥离头部 )]}'\n；
 * 2. 基于“长度前缀 + 块切分”算法解析多块合并流；
 * 3. 递归反序列化嵌套 JSON 字符串；
 * 4. 三级回退阶梯（① 优先 inner[4][0][1][0]、② 候选遍历排序最长正文、③ Fail-Open 容错）。
 */
export class GeminiRpcParser {
  private userPrompt: string;
  private currentSnapshot = '';

  constructor(options: GeminiParseOptions = {}) {
    this.userPrompt = options.userPrompt?.trim() || '';
  }

  /**
   * 解包单个流式分片（支持包含多个 length-prefixed 块的合并数据）
   */
  public parseChunk(rawChunk: string): GeminiParseResult | null {
    if (!rawChunk) return null;

    let text = rawChunk.trim();
    // 1. 剥离头部安全防护前缀
    if (text.startsWith(`)]}'`)) {
      text = text.slice(4).trim();
    }

    if (!text) return null;

    // 2. 切分多个分块（支持 123\n[[...]]\n456\n[[...]] 复合流）
    const blocks = this.splitBatchexecuteBlocks(text);
    let latestExtracted: string | null = null;

    for (const block of blocks) {
      try {
        const parsed = JSON.parse(block);
        if (!Array.isArray(parsed)) continue;

        // 定位所有 wrb.fr 条目并依次尝试提取
        const wrbEntries: unknown[][] = [];
        this.collectWrbEntries(parsed, wrbEntries);

        for (const wrb of wrbEntries) {
          const res = this.extractTextFromWrb(wrb);
          if (res !== null && res.length > 0) {
            latestExtracted = res;
          }
        }
      } catch {
        // 容错忽略破损块
      }
    }

    if (latestExtracted !== null) {
      this.currentSnapshot = latestExtracted;
      return {
        text: this.currentSnapshot,
        isDone: false,
      };
    }

    return null;
  }

  /**
   * 按照长度前缀或括号匹配切分 Batchexecute 块
   */
  private splitBatchexecuteBlocks(text: string): string[] {
    const blocks: string[] = [];
    let remaining = text.trim();

    while (remaining.length > 0) {
      // 检查当前游标是否有数字长度前缀：例如 "123\n[["
      const lenMatch = remaining.match(/^(\d+)\s*\n/);
      if (lenMatch && lenMatch[1]) {
        const prefixLen = lenMatch[0].length;
        const blockLen = parseInt(lenMatch[1], 10);
        const blockContent = remaining.slice(prefixLen, prefixLen + blockLen).trim();
        if (blockContent) {
          blocks.push(blockContent);
        }
        remaining = remaining.slice(prefixLen + blockLen).trim();
      } else {
        // 无显式长度前缀，作为单体 JSON 块整体解析
        blocks.push(remaining);
        break;
      }
    }

    return blocks;
  }

  /**
   * 递归收集所有含 "wrb.fr" 的条目（防止首条为空元数据导致漏判）
   * D3 加固：maxDepth 保护防止恶意深度嵌套触发调用栈溢出
   */
  private collectWrbEntries(data: unknown[], result: unknown[][], depth = 0): void {
    if (depth > 20) return; // D3：超过安全深度阈值则跳过
    for (const item of data) {
      if (Array.isArray(item)) {
        if (item[0] === 'wrb.fr') {
          result.push(item);
        } else {
          this.collectWrbEntries(item, result, depth + 1);
        }
      }
    }
  }

  /**
   * 从单个 wrb.fr 条目中提取有效正文
   */
  private extractTextFromWrb(wrbEntry: unknown[]): string | null {
    let payload = wrbEntry[2] ?? wrbEntry[4] ?? wrbEntry;

    // 关键修复：Google Batchexecute 协议中 wrbEntry[2] 常常是序列化的 JSON 字符串
    if (typeof payload === 'string') {
      try {
        payload = JSON.parse(payload);
      } catch {
        // 保持原样
      }
    }

    // 阶梯 ①: 优先定位 inner[4][0][1][0] 核心正文槽位
    if (Array.isArray(payload)) {
      try {
        const candidate = payload[4]?.[0]?.[1]?.[0] ?? payload[0]?.[1]?.[0];
        if (typeof candidate === 'string' && candidate.trim().length > 0) {
          return candidate;
        }
      } catch {
        // 静默进入阶梯 ②
      }
    }

    // 阶梯 ②: 递归搜集所有深层候选字符串（自动解包内层 JSON）
    const candidates: string[] = [];
    this.collectStringCandidates(wrbEntry.slice(2), candidates);

    // 过滤与排序
    const validCandidates = candidates.filter((str) => {
      const trimmed = str.trim();
      if (!trimmed) return false;
      if (
        trimmed === 'wrb.fr' ||
        trimmed.startsWith('assistant.') ||
        trimmed.startsWith('rc_') ||
        trimmed === 'generic' ||
        /^[a-zA-Z0-9_-]+\.[a-zA-Z0-9_.-]+$/.test(trimmed)
      ) {
        return false;
      }
      if (this.userPrompt && trimmed === this.userPrompt) {
        return false;
      }
      return true;
    });

    // D1 修复：sort 后直接取 [0]，避免提前非空检查造成误读
    const best = validCandidates.sort((a, b) => b.length - a.length)[0] ?? null;
    return best;
  }

  /**
   * 递归收集字符串候选（若遇到嵌套 JSON 字符串，则自动递归解析）
   */
  private collectStringCandidates(node: unknown, result: string[]): void {
    if (typeof node === 'string') {
      const trimmed = node.trim();
      // 关键防呆：若字符串本身是嵌套的 JSON 数组或对象，绝不可直接当候选，必须深入反序列化
      if (
        (trimmed.startsWith('[') && trimmed.endsWith(']')) ||
        (trimmed.startsWith('{') && trimmed.endsWith('}'))
      ) {
        try {
          const parsed = JSON.parse(trimmed);
          this.collectStringCandidates(parsed, result);
          return;
        } catch {
          // 不是合法 JSON，作为普通文本
        }
      }
      result.push(node);
    } else if (Array.isArray(node)) {
      for (const item of node) {
        this.collectStringCandidates(item, result);
      }
    } else if (node && typeof node === 'object') {
      for (const val of Object.values(node)) {
        this.collectStringCandidates(val, result);
      }
    }
  }

  public getCurrentSnapshot(): string {
    return this.currentSnapshot;
  }

  public reset(): void {
    this.currentSnapshot = '';
  }
}
