import { describe, it, expect } from 'vitest';
import { GeminiRpcParser } from '../lib/parsers/gemini-rpc-parser';

describe('AC-GEMINI: Google Gemini Batchexecute RPC 文本流嵌套解包与三级回退', () => {
  it('剥离头部安全前缀 )]}\'\\n 并通过三级阶梯 ① 优先提取 inner[4][0][1][0] 正文', () => {
    const parser = new GeminiRpcParser();

    // 模拟 Google Gemini 标准 RPC 响应数据
    const rawRpc = `)]}'\n\n[["wrb.fr","assistant.lamda",[null,null,null,null,[["rc_1",["你好！我是 Gemini，很高兴为你提供帮助。"]]]]]]`;

    const res = parser.parseChunk(rawRpc);
    expect(res).not.toBeNull();
    expect(res?.text).toBe('你好！我是 Gemini，很高兴为你提供帮助。');
    expect(res?.isDone).toBe(false);
  });

  it('支持长度前缀格式的分块 Batchexecute 响应', () => {
    const parser = new GeminiRpcParser();

    const payload = `[["wrb.fr",null,null,null,[null,null,null,null,[["rc_2",["第二段增量回答。"]]]]]]`;
    const chunkWithLength = `)]}'\n\n${payload.length}\n${payload}\n`;

    const res = parser.parseChunk(chunkWithLength);
    expect(res?.text).toBe('第二段增量回答。');
  });

  it('三级阶梯 ②：当 Google 键位漂移导致 inner[4][0][1][0] 为空时，深度遍历回退提取非 Prompt 的首个有效正文', () => {
    const parser = new GeminiRpcParser({ userPrompt: '什么是量子纠缠？' });

    // 构造键位漂移结构：正文不在 [4][0][1][0]，而是在 [3][1][2]
    const driftedPayload = `)]}'\n\n[["wrb.fr","corrupted.path",[null,null,["什么是量子纠缠？"],[["ignore",null,["量子纠缠是量子力学中的一种特殊物理现象。"]]]]]]`;

    const res = parser.parseChunk(driftedPayload);
    expect(res?.text).toBe('量子纠缠是量子力学中的一种特殊物理现象。');
  });

  it('三级阶梯 ③：面对极端破损或格式截断的数据，Fail-Open 标记 PARTIAL 且 0 抛出异常崩溃', () => {
    const parser = new GeminiRpcParser();

    // 极端破坏的非合规 JSON 截断数据
    const brokenChunk = `)]}'\n\n12345\n[["wrb.fr", "truncated_unclosed_data`;

    expect(() => {
      const res = parser.parseChunk(brokenChunk);
      expect(res).toBeNull();
    }).not.toThrow();
  });

  it('跨分块流式累积长文本 Markdown 解包保持原子自洽', () => {
    const parser = new GeminiRpcParser();

    // 帧 1
    const f1 = parser.parseChunk(`)]}'\n\n[["wrb.fr",null,[null,null,null,null,[["rc_1",["# 深度报告\\n\\n第一节内容"]]]]]]`);
    expect(f1?.text).toBe('# 深度报告\n\n第一节内容');

    // 帧 2 (全量快照更新)
    const f2 = parser.parseChunk(`[["wrb.fr",null,[null,null,null,null,[["rc_1",["# 深度报告\\n\\n第一节内容\\n\\n第二节扩展"]]]]]]`);
    expect(f2?.text).toBe('# 深度报告\n\n第一节内容\n\n第二节扩展');
  });

  it('真实 Google Batchexecute 协议中 wrbEntry[2] 为序列化 JSON 字符串时正确反序列化', () => {
    const parser = new GeminiRpcParser();

    // 真实 Google 响应往往把载荷序列化为 JSON 字符串置于 wrbEntry[2]
    const serializedPayload = JSON.stringify([null, null, null, null, [['rc_real', ['真实反序列化正文结果。']]]]);
    const rawGoogleChunk = `)]}'\n\n[["wrb.fr","assistant.lamda",${JSON.stringify(serializedPayload)}]]`;

    const res = parser.parseChunk(rawGoogleChunk);
    expect(res?.text).toBe('真实反序列化正文结果。');
  });

  it('支持 50ms 节流窗口合并多个长度前缀块的 Batchexecute 复合流', () => {
    const parser = new GeminiRpcParser();

    const block1 = `[["wrb.fr","assistant.lamda",[null,null,null,null,[["rc_1",["块1内容"]]]]]]`;
    const block2 = `[["wrb.fr","assistant.lamda",[null,null,null,null,[["rc_2",["块2内容覆盖"]]]]]]`;
    const compoundChunk = `)]}'\n\n${block1.length}\n${block1}\n${block2.length}\n${block2}\n`;

    const res = parser.parseChunk(compoundChunk);
    expect(res?.text).toBe('块2内容覆盖');
  });

  it('包含多个 wrb.fr 条目时（首个为空元数据），能正确向下检索有效正文', () => {
    const parser = new GeminiRpcParser();

    const multiWrb = `)]}'\n\n[["wrb.fr","meta.session",[null]],["wrb.fr","assistant.lamda",[null,null,null,null,[["rc_1",["有效正文"]]]]]]`;
    const res = parser.parseChunk(multiWrb);
    expect(res?.text).toBe('有效正文');
  });
});
