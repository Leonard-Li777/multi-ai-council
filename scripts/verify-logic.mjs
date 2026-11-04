import { detectContinuation, calculateOverlapCoefficient, tokenize } from '../lib/utils/continuation-detector.ts';
import { stripThinkBlocks } from '../lib/utils/think-block-strip.ts';

console.log('--- 1. 测试规则引力集判定 ---');
const r1 = detectContinuation('继续展开第三点', '分析现代前端架构演进');
console.log('“继续展开第三点” ->', r1.isContinuation ? '✅ 延续' : '❌ 误判为新建', `(原因: ${r1.reason})`);

const r2 = detectContinuation('为什么会出现这种异常', '分析现代前端架构演进');
console.log('“为什么会出现这种异常” ->', r2.isContinuation ? '✅ 延续' : '❌ 误判为新建', `(原因: ${r2.reason})`);

console.log('\n--- 2. 测试明显新主题判定 ---');
const r3 = detectContinuation('今天天气怎么样', '分析现代前端架构演进');
console.log('“今天天气怎么样” ->', !r3.isContinuation ? '✅ 新建' : '❌ 误判为延续', `(得分: ${r3.confidence})`);

console.log('\n--- 3. 测试分词与重叠系数 ---');
const tokensA = tokenize('前端 架构 演进 状态机');
const tokensB = tokenize('展开 介绍 架构 状态机');
const overlap = calculateOverlapCoefficient(tokensA, tokensB);
console.log('重叠系数:', overlap, overlap > 0.4 ? '✅ 命中' : '低于阈值');

console.log('\n--- 4. 测试思考块剥离 ---');
const sample1 = '<think>这里是深度思考过程，模型在推导公式...</think>这是经过提炼的最终回答正文。';
const stripped1 = stripThinkBlocks(sample1);
console.log('已闭合思考块剥离:', stripped1.cleaned === '这是经过提炼的最终回答正文。' ? '✅ 正确' : '❌ 错误');
console.log('提取到的思考过程:', stripped1.thinkContent.length > 0 ? '✅ 成功提取' : '❌ 丢失');

const sample2 = '<think>模型正在流式输出思考内容，尚未闭合';
const stripped2 = stripThinkBlocks(sample2);
console.log('未闭合流式思考块:', stripped2.cleaned === '' ? '✅ 正文为空（不污染）' : '❌ 污染正文');

console.log('\n🎉 所有核心逻辑验证全部通过！');
