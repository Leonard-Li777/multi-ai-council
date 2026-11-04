const fs = require('fs')
const path = require('path')

const ROOT_DIR = path.resolve(__dirname, '../../../../')
const OUTPUT_DIR = path.join(ROOT_DIR, 'docs', 'prompts')
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'skills-optimization-prompt.md')

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })
}

// 技能文件映射清单
const SKILL_SECTIONS = [
  {
    category: '一、核心打磨与执行双循环 Skill (Core Loops)',
    description: '负责编码前方案审查打磨（plan-loop）与初始编码及多轮审查修复闭环（implement-loop）的核心机制。',
    skills: [
      {
        id: 'plan-loop',
        title: 'Plan-Loop (编码前方案红队审查与自闭环打磨)',
        files: [
          { name: 'SKILL.md', path: path.join(ROOT_DIR, '.agents/skills/plan-loop/SKILL.md') },
          { name: 'REFERENCE.md', path: path.join(ROOT_DIR, '.agents/skills/plan-loop/REFERENCE.md') },
          { name: 'EXAMPLES.md', path: path.join(ROOT_DIR, '.agents/skills/plan-loop/EXAMPLES.md') }
        ]
      },
      {
        id: 'implement-loop',
        title: 'Implement-Loop (自闭环智能编码与多轮自动审查修复)',
        files: [
          { name: 'SKILL.md', path: path.join(ROOT_DIR, '.agents/skills/implement-loop/SKILL.md') },
          { name: 'REFERENCE.md', path: path.join(ROOT_DIR, '.agents/skills/implement-loop/REFERENCE.md') },
          { name: 'EXAMPLES.md', path: path.join(ROOT_DIR, '.agents/skills/implement-loop/EXAMPLES.md') }
        ]
      }
    ]
  },
  {
    category: '二、文档架构治理与知识拓扑 Skill (Knowledge Topology & Governance)',
    description: '负责全系统技术文档自生长、4 环同心圆拓扑、会话知识回流五维审查、零死链门禁及自动化目录生成的治理核心。',
    skills: [
      {
        id: 'doc-architect',
        title: 'Doc-Architect (自生长防腐蚀文档架构治理专家)',
        files: [
          { name: 'SKILL.md', path: path.join(ROOT_DIR, '.agents/skills/doc-architect/SKILL.md') },
          { name: 'REFERENCE.md', path: path.join(ROOT_DIR, '.agents/skills/doc-architect/REFERENCE.md') },
          { name: 'check-doc-health.js (4环门禁核心实现)', path: path.join(ROOT_DIR, '.agents/skills/doc-architect/scripts/check-doc-health.js') }
        ]
      }
    ]
  },
  {
    category: '三、审查与裁决协同 Skill (Review, Delegation & Triaging)',
    description: '与 plan-loop / implement-loop 紧密咬合的代码与方案审查、移交提示词生成、第三方审查代理及去伪存真裁决机制。',
    skills: [
      {
        id: 'open-code-review-delegate',
        title: 'Open-Code-Review-Delegate (确定性文件与规则提取 + Agent自主盲审代理)',
        files: [
          { name: 'SKILL.md', path: 'C:/Users/lilun/.claude/skills/open-code-review-delegate/SKILL.md' }
        ]
      },
      {
        id: 'review-handoff',
        title: 'Review-Handoff (移交第三方审查：免diff算力消耗 + 会话记忆提取 + 一键复制生成)',
        files: [
          { name: 'SKILL.md', path: path.join(ROOT_DIR, '.agents/skills/review-handoff/SKILL.md') },
          { name: 'REFERENCE.md', path: path.join(ROOT_DIR, '.agents/skills/review-handoff/REFERENCE.md') },
          { name: 'EXAMPLES.md', path: path.join(ROOT_DIR, '.agents/skills/review-handoff/EXAMPLES.md') }
        ]
      },
      {
        id: 'review-vet',
        title: 'Review-Vet (审查结论去伪存真：剥离大词 + 痛点方案解耦 + 契约一票否决 + 四象限分流)',
        files: [
          { name: 'SKILL.md', path: path.join(ROOT_DIR, '.agents/skills/review-vet/SKILL.md') },
          { name: 'REFERENCE.md', path: path.join(ROOT_DIR, '.agents/skills/review-vet/REFERENCE.md') },
          { name: 'EXAMPLES.md', path: path.join(ROOT_DIR, '.agents/skills/review-vet/EXAMPLES.md') }
        ]
      }
    ]
  },
  {
    category: '四、上下游衔接与执行落地 Skill (Execution, Specs & Upstream/Downstream)',
    description: '从方案设计与工单拆解（to-spec, to-issues）、极简通信压缩（caveman）、编码执行（implement）、领域建模（domain-modeling）、复盘沉淀（retro）到提交（smart-git-commit）。',
    skills: [
      {
        id: 'caveman',
        title: 'Caveman (极致压缩通信模式：砍掉废话客套、专注技术实质、节约长循环 Token)',
        files: [
          { name: 'SKILL.md', path: path.join(ROOT_DIR, '.agents/skills/caveman/SKILL.md') }
        ]
      },
      {
        id: 'to-spec',
        title: 'To-Spec (本地深度技术规格说明书生成器：遵循 4 环 L3 规范)',
        files: [
          { name: 'SKILL.md', path: path.join(ROOT_DIR, '.agents/skills/to-spec/SKILL.md') }
        ]
      },
      {
        id: 'to-issues',
        title: 'To-Issues (本地垂直切片工单生成器：细长 Tracer Bullets，端到端打通)',
        files: [
          { name: 'SKILL.md', path: path.join(ROOT_DIR, '.agents/skills/to-issues/SKILL.md') }
        ]
      },
      {
        id: 'implement',
        title: 'Implement (基础编码执行器：TDD驱动、类型检查与单测守护)',
        files: [
          { name: 'SKILL.md', path: path.join(ROOT_DIR, '.agents/skills/implement/SKILL.md') }
        ]
      },
      {
        id: 'smart-git-commit',
        title: 'Smart-Git-Commit (智能分批原子提交：路径启发优先 + 疑难按需懒查 diff + 宁并勿拆)',
        files: [
          { name: 'SKILL.md', path: path.join(ROOT_DIR, '.agents/skills/smart-git-commit/SKILL.md') }
        ]
      },
      {
        id: 'domain-modeling',
        title: 'Domain-Modeling (领域建模专家：维护 CONTEXT.md 术语表与 ADR 决策记录)',
        files: [
          { name: 'SKILL.md', path: path.join(ROOT_DIR, '.agents/skills/domain-modeling/SKILL.md') },
          { name: 'ADR-FORMAT.md', path: path.join(ROOT_DIR, '.agents/skills/domain-modeling/ADR-FORMAT.md') },
          { name: 'CONTEXT-FORMAT.md', path: path.join(ROOT_DIR, '.agents/skills/domain-modeling/CONTEXT-FORMAT.md') }
        ]
      },
      {
        id: 'retro',
        title: 'Retro (任务复盘与环境进化专家：沉淀踩坑教训与长效工具/规范优化)',
        files: [
          { name: 'SKILL.md', path: path.join(ROOT_DIR, '.agents/skills/retro/SKILL.md') }
        ]
      },
      {
        id: 'code-review',
        title: 'Code-Review (双轴并行代码审查基准：Standards 规范轴 vs Spec 需求轴)',
        files: [
          { name: 'SKILL.md', path: path.join(ROOT_DIR, '.agents/skills/code-review/SKILL.md') }
        ]
      }
    ]
  }
]

let output = ''

// 1. 顶部提示词前言与对外部 AI 的指导规范
const agentsMdContent = fs.readFileSync(path.join(ROOT_DIR, 'AGENTS.md'), 'utf8')

output += `# AI Agent 技能协同体系深度审查与全面优化任务提示词

> **提示词目标与角色定义**：
> 你是一位世界顶级的 **AI Agent 架构师、大模型工作流工程专家与现代软件系统工程专家**。
> 本提示词汇集了工业级开源项目（Firefly AI Folder）中正在运行的全套核心 Agent Skill 系统——包括三大核心支柱：
> 1. \`plan-loop\`（方案立项与红队多轮盲审打磨闭环）
> 2. \`implement-loop\`（自闭环编码与自动化多轮审查修复）
> 3. \`doc-architect\`（自生长防腐蚀 4 环文档架构与知识图谱治理）
> 以及与之紧密协同的 10 余个配套技能（包括 \`open-code-review-delegate\`, \`review-handoff\`, \`review-vet\`, \`caveman\`, \`domain-modeling\`, \`to-spec\`, \`to-issues\`, \`smart-git-commit\`, \`retro\`, \`code-review\` 等）。
>
> **请针对这一套完整的 Agent 协同体系进行全面、深度、苛刻的架构审视、实战漏洞排查与体系化升级优化**。
> 所有相关技能的**全部完整源码（无任何省略、无截断、无外链）**均已直接源文嵌入在下文。

---

## 0. 系统常驻内核与项目硬性契约 (Project Invariants: AGENTS.md)

以下为本系统各技能必须共同遵守的底线契约（L1 内核）。审查各技能时，请核验其对该底线契约的维护与执行力度：

\`\`\`\`markdown
${agentsMdContent}
\`\`\`\`

---

## 优化审视维度要求 (Optimization Dimensions)

请从以下 6 个核心维度对本体系进行彻底的红队诊断，并提出重构与升级方案：

### 1. 闭环收敛性与状态机健壮度 (Convergence & State Machine Robustness)
- 循环机制（Plan Loop 默认最多 3 轮、Implement Loop 默认最多 4 轮）在边界条件下的终止判定是否足够确定性？
- 是否存在主 Agent 与子 Agent 意见分歧导致的死循环、逻辑震荡（Ping-Pong / Oscillation）或虚假通过（False Clean Pass）？
- 熔断机制（Max Rounds Breaker / Oscillation Breaker / Human Escalation）是否能够干净利落地阻断 Token 无效空转？

### 2. 上下文与 Token 经济学 (Context & Token Economy)
- 在长对话跨多轮循环下，信息打包（Handoff）是否做到了最大信息熵与最小 Token 消耗？
- 为什么 \`review-handoff\` 坚持“免 diff 算力原则”？其与 \`open-code-review-delegate\`（基于确定性 preview 与 rule 提取）的结合是否存在冗余或信息断层？
- \`caveman\` 模式作为长循环中的上下文压缩器，在多智能体（派生子 Agent）交互中是否被彻底贯彻？

### 3. 多智能体职责划分与正交隔离 (Subagent Orchestration & Orthogonality)
- 主 Agent（调度、编码、去伪存真、原地修订）与子 Agent（红队盲审、独立审查）的职责边界是否清晰正交？
- 子 Agent 通信协议（Prompt 组装、Role 映射、上下文注入）是否具备零污染、零作者偏差？
- \`open-code-review-delegate\`、\`review-handoff\` 与 \`review-vet\` 组成的三位一体审查链条是否存在死角？

### 4. 工程现实主义与防腐拦截 (Reality Grounding & Anti-Overengineering)
- \`review-vet\` 提出的“剥离大词修辞”、“痛点(Why)与方案(How)解耦”以及“三维真实性校验（需求基准/代码事实/既定契约）”在实战中是否足够锋利？
- 是否能有效拦截 AI 常见的“假大空伪需求”与“过度工程”？
- 对不可破坏的系统契约（如 Genesis V1 单库无迁移、受控概念枚举、Windows 路径规范）的守护是否坚固？

### 5. 知识拓扑与文档治理 (Knowledge Topology & Living Documentation)
- \`doc-architect\` 提出的「4 环同心圆骨架（L1 Kernel $\\leftrightarrow$ L2 Standards $\\leftrightarrow$ L3 Specs $\\leftrightarrow$ L4 Context）」与「同环网状自由串联、异环严格单级相邻」规则，在保障知识库自生长与防腐化方面表现如何？
- 会话结束时的“五维知识回流审查”（原文档就地纠偏、领域模型提炼、相关文档扩展、重要度升降级、复盘触发）如何更自动化？
- TOC 目录自动化覆盖刷新与健康度体检门禁（check-doc-health.js）是否无懈可击？

### 6. 端到端工作流协同平滑度 (End-to-End Pipeline Cohesion)
- 从 \`to-spec\` / \`to-issues\` $\\rightarrow$ \`plan-loop\` $\\rightarrow$ \`implement-loop\` $\\rightarrow$ \`smart-git-commit\` $\\rightarrow$ \`doc-architect\` 的全生命周期流水线，上下游契约是否完全对齐？是否存在格式割裂或手动粘合摩擦？

---

## 期望产出的优化报告结构 (Expected Deliverables)

在详细阅读下文完整的技能源码后，请输出一份结构化、高密度且极具建设性的优化报告：
1. **体系架构总评与雷达评分**：总结本系统的核心亮点、独特创新以及潜在架构隐患；
2. **深度缺陷与死穴诊断**：指出当前流程中可能导致 Agent 行为失控、Token 爆炸、逻辑振荡或断流的致命设计瑕疵；
3. **关键技能重构与升级方案**：针对 \`plan-loop\`、\`implement-loop\`、\`doc-architect\` 及审查三件套（\`review-handoff\` / \`open-code-review-delegate\` / \`review-vet\`）提出具体的优化重写建议；
4. **端到端流程进化建议**：如何进一步提升整个工作流的自动化、健壮性与开发体验。

---

`

// 2. 遍历并拼接所有 Skill 的完整源文
for (const section of SKILL_SECTIONS) {
  output += `\n# ${section.category}\n\n> ${section.description}\n\n`

  for (const skill of section.skills) {
    output += `## 模块：${skill.title} (\`${skill.id}\`)\n\n`

    for (const file of skill.files) {
      if (!fs.existsSync(file.path)) {
        console.error(`[Error] File not found: ${file.path}`)
        process.exit(1)
      }

      const content = fs.readFileSync(file.path, 'utf8')
      const ext = path.extname(file.name).toLowerCase()
      const lang = ext === '.js' ? 'javascript' : ext === '.json' ? 'json' : 'markdown'

      output += `### 📄 源码文件：\`${skill.id}/${file.name}\`\n\n`
      output += `\`\`\`\`${lang}\n`
      output += content
      if (!content.endsWith('\n')) output += '\n'
      output += `\`\`\`\`\n\n`
    }
  }
}

// 写入目标文件
fs.writeFileSync(OUTPUT_FILE, output, 'utf8')

const stats = fs.statSync(OUTPUT_FILE)
console.log(`[Success] Successfully generated prompt file: ${OUTPUT_FILE}`)
console.log(`[Info] Total size: ${(stats.size / 1024).toFixed(2)} KB, Lines: ${output.split('\n').length}`)
