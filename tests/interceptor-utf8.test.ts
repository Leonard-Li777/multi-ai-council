import { describe, it, expect } from 'vitest';
import { StreamingUtf8Decoder } from '../lib/interceptor/utf8-decoder';

describe('AC2: 多字节 UTF-8 零乱码与跨包切分解码 (StreamingUtf8Decoder)', () => {
  it('应准确无损解码任意多字节汉字、Emoji 与符号', () => {
    const decoder = new StreamingUtf8Decoder();
    const text = '“你好，世界！多模型终审 🚀 Multi-AI Council”';
    const encoder = new TextEncoder();
    const bytes = encoder.encode(text);

    const decoded = decoder.decode(bytes);
    expect(decoded).toBe(text);
    expect(decoded).not.toContain('\uFFFD');
  });

  it('在汉字跨包被奇数字节割裂（1字节/2字节分块）时，100% 不产生 \\uFFFD 乱码', () => {
    const decoder = new StreamingUtf8Decoder();
    const text = '多模型终审架构：前门叩门，后门收信。彻底消除截断！';
    const encoder = new TextEncoder();
    const bytes = encoder.encode(text);

    // 将字节按单字节或不规则奇数字节流式灌入
    let reconstructed = '';
    // 每次灌 1 到 2 个字节模拟极度恶劣的碎片网络切片
    for (let i = 0; i < bytes.length; i += 2) {
      const chunk = bytes.subarray(i, Math.min(i + 2, bytes.length));
      const partial = decoder.decode(chunk);
      reconstructed += partial;
    }
    reconstructed += decoder.flush();

    expect(reconstructed).toBe(text);
    expect(reconstructed).not.toContain('\uFFFD');
  });

  it('单字节极端切包（每次 1 byte）测试', () => {
    const decoder = new StreamingUtf8Decoder();
    const text = '你好世界';
    const encoder = new TextEncoder();
    const bytes = encoder.encode(text);

    let reconstructed = '';
    for (let i = 0; i < bytes.length; i++) {
      reconstructed += decoder.decode(bytes.subarray(i, i + 1));
    }
    reconstructed += decoder.flush();

    expect(reconstructed).toBe(text);
    expect(reconstructed).not.toContain('\uFFFD');
  });
});
