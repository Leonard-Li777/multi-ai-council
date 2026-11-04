#!/usr/bin/env node
/**
 * .agents/skills/doc-architect/scripts/generate-doc-toc.js
 * 
 * 4 环知识拓扑架构自动化目录导航 (Table of Contents) 生成与检查工具
 * 
 * 核心功能：
 * 1. 扫描 Markdown 文档的 H1~H5 标题；
 * 2. 检测文件头（前 80 行内）是否已具备目录导航；
 * 3. 自动生成标准清晰的 Markdown 锚点目录并插入文件头合适位置（前 60 行内）；
 * 4. 助力 Agent 先读目录导航，通过锚点或行号定向检索，节约 Token 消耗。
 */

const fs = require('fs')
const path = require('path')

const ROOT_DIR = path.resolve(__dirname, '../../../../')

// 目录区判据（2026-10-23 收窄，详见 extractHeadings 内修复记录）：
// 只有**以目录关键词起头**（后接行尾或括号）的标题才是「目录自身」，
// 标题正文里出现「目录」二字不算（否则会静默吞掉真标题）。
const TOC_TITLE_RE = /^(?:章节速查|目录|导引|Table of Contents|TOC)\s*(?:\(|$)/i
const TOC_HEAD_RE = /^#{1,6}\s+(?:章节速查|目录|导引|Table of Contents|TOC)\s*(?:\(|$)/i
// 目录区里允许出现的行形态：目录条目、指引引用块、分隔线、空行
const TOC_ROW_RE = /^\s*- \[[\s\S]*\]\(#.*\)$/
function isTocRegionLine(line) {
  const t = line.trim()
  return t === '' || t === '---' || t.startsWith('>') || TOC_ROW_RE.test(line)
}

// 仅剥离**围栏**代码块（```...```），**刻意保留行内代码**。
//
// 修复记录（2026-10-14）：旧实现名为 stripCodeBlocks，除围栏块外还连同行内代码的
// 「内容」一并剥离（`clean.replace(/`[^`\n]*`/g, '')`）。而 extractHeadings() 复用
// 同一份剥离结果同时产出「TOC 文案」与「锚点 slug」，导致两个缺陷：
//   1. TOC 文案丢词 —— `### 2.3 命名误导：`legacy` ≠ schema 遗留` 被生成成
//      `2.3 命名误导： ≠ schema 遗留`（"legacy" 凭空消失，语义被破坏）；
//   2. 锚点错配 —— GitHub 只剥离反引号、保留其内容（`legacy` → legacy），
//      剥离版 slug 少一段，全库 227 文件 / 886 个含行内代码的标题锚点全部漂移。
// 围栏代码块仍必须剥离：否则代码块内的 `# 注释` 行会被误判为标题。
//
// 修复记录（2026-10-23，第 54 项放行轮 / 账本 §4.70）：原实现用**成对正则**
// `content.replace(/```[\s\S]*?```/g, '')` 剥围栏，在长文档上与真实围栏配对不一致：
// 本仓账文前态实测有 9 处**行中带 ``` 的说明行**，它们被当作配对端点，于是**少采 25 条真标题**
// （同基现跑，口径 = `^#{2,4} ` 跳围栏、仅排除 `## 章节速查` 前缀：
// 逐行开关式 357 条 / 成对正则式 332 条）。旧工具自身打印的 337 项属**另一口径**（其采集范围为 H1–H5、且把标题正文
// 任意位置含「目录」二字的也一并排除，本档复算 = 338），与上面两个数不同基 ⇒ 严禁互引或对字。
// ⇒ 改为**逐行开关式**扫描：仅行首围栏参与开关，围栏内行与围栏行本身置为空串
// （**保留行号**，使 lineNum 与文件真实行号对齐 —— 原实现剥离后行号整体前移，`lineNum` 一直失真）。
//
// ⚠ 只把行首 ``` 当围栏开关，**严禁**把 ~~~ 也纳入：登记正尺只认 ```，
// 且 W3 spec §4(c) 记有前科 —— 本仓账文围栏区内有一行 `~~~~~^^^` 是 ASCII 图，
// 一旦按 `~` 配对，标题读数曾从 316 掉到 141。本档现跑读数：行首 ~~~ 为 0 处、
// 缩进 ~~~ 为 1 处 ⇒ 纳入与否对本档同形，但判据必须与登记正尺逐字一致，
// 严禁出现"尺与生成器不同形"的分叉。行首缩进的 ``` 同样不参与开关。
//
// 修复记录（2026-10-23，第 57 项 / 账本 §4.73）：上面「逐行奇偶开关」在**嵌套围栏**
// （外层 ```` 包裹内层 ```）下失能 —— 内层 ``` 会把开关提前翻回块外，于是围栏区内的
// 伪标题被采成目录行、块内真标题被漏采。误采面现跑 = 11 份（少采 105 行 / 多采 71 行；口径 = tracked .md
// 除 docs/archive/ 共 1259 份，判据 = 标题集 lineNum#title#slug 全等差分，非条数差分），
// 交付面 2 份：`docs/prd/0057-s1-code-review-prompt.md`（盘上 11 条、严格口径真值 2 条 ⇒ 9 条死链）、
// `docs/features/ai/LlamaIndexTS 参考资料.md`（目录行 28 → 26）。
// ⇒ 改为**严格 CommonMark 反引号围栏配对**（长度栈，非奇偶）：开启 = 行首 ≥3 反引号且信息串不含反引号；
//   闭合 = 同字符、长度 ≥ 开启长度、除围栏符外无其它内容；围栏行本身与块内行一律置空串（保留行号）。
// 缩进 0~3 空格围栏与本案分叉实测 0 份 ⇒ 仍不纳入（与上方登记正尺逐字一致）。
// ⚠ 另记一处本函数管不到的盲区：`processFile()` 的 `headings.length < 2` 早退发生在覆盖分支之前，
//   故标题过少的文档即便盘上挂着死目录行，跑工具也是逐字节零变化（本仓实例 = `docs/features/ai/README.md`）
//   ⇒ "再跑一次零变化"不等于"目录已同步"，该早退面属另一开口，本项不改覆盖策略。
const FENCE_MARK_RE = /^(`{3,})(.*)$/

function stripFencedCodeBlocks(content) {
  const out = []
  // 未闭合围栏的开启长度栈：嵌套时内层 ``` 只是内容，不参与开关（奇偶式正是此处失能）
  const stack = []
  for (const line of content.split(/\r?\n/)) {
    const m = FENCE_MARK_RE.exec(line)
    if (!m) {
      out.push(stack.length ? '' : line)
      continue
    }
    const len = m[1].length
    const info = m[2]
    if (stack.length && len >= stack[stack.length - 1] && info.trim() === '') {
      stack.pop()
      out.push('')
      continue
    }
    if (!stack.length && !info.includes('`')) stack.push(len)
    out.push('')
  }
  return out
}

// 生成符合 GitHub 渲染实态的锚点 slug
//
// 修复记录（2026-10-23，第 54 项放行轮 / 账本 §4.69 第 2 节两测量面实测）：原实现在末尾
// 做了 `.trim()` + `/\s+/g` + `/-+/g → '-'` + `/^-|-$/g`（**折叠尺 rB**），
// 与 GitHub 渲染锚不符 —— 实测口径 = 小写 → 剥非白名单字符 → **每个空白各自**转 `-`，
// **不折叠连续 `-`、不去首尾 `-`**，同名标题按文档出现顺序加 `-1/-2/…`（**尺 rA**）。
// 折叠尺的产物是「点了不跳」的死链（账本首块 85 处），故本函数改为 rA；
// 尾部的 `.trim()` 一并删除：实测 `Emoji Title 🏡` → `emoji-title-` 证明端点 `-` 不被剥。
// 同名计数器见 anchorOf()，须按文档顺序逐条分配，不能只靠标题文本。
function generateGithubSlug(title) {
  return title
    .trim()
    .toLowerCase()
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // 剥离其中的 markdown 链接
    .replace(/[`*~]/g, '') // 剥离格式符（**不含下划线**：github-slugger 的剔除类 `\[-\^` 止于 0x5E，`_`(0x5F) 被保留）
    .replace(/[^\p{L}\p{N}\s\-_]/gu, '') // 保留 Unicode 字母、数字、中文、空格、下划线、连字符
    .replace(/\s/g, '-') // 每个空白**各自**转一个连字符（GitHub 不折叠，故用 /\s/g 而非 /\s+/g）
  // ⚠ 此处**严禁**再加回 `.trim()` / `/-+/g → '-'` / `/^-|-$/g`：那三步是折叠尺 rB，
  //   实测与 GitHub 渲染锚不符（§4.69 第 2 节），加回来即重新制造死链。
}

// 检查文件前 80 行内是否已存在目录导航
function hasExistingToc(content) {
  const lines = content.split(/\r?\n/).slice(0, 80)
  const headerContent = lines.join('\n')
  return /(?:##\s*(?:章节速查|目录|导引|Table of Contents|TOC))/i.test(headerContent)
}

// 提取文档的 H1~H5 标题
function extractHeadings(content, maxDepth = 4) {
  const lines = stripFencedCodeBlocks(content)
  const headings = []

  let foundFirstH1 = false
  // 同名标题计数器（GitHub 实态：首现裸 slug，其后依次 `-1`、`-2`…，按文档出现顺序）。
  // 用 taken 集合递推而非「出现次数」计数，可顺带处理极端撞车：
  // 某标题的原生锚恰好等于另一重复标题的 `base-N` 形式时，继续递增直到未被占用。
  const taken = new Set()

  function anchorOf(base) {
    let slug = base
    let k = 0
    while (taken.has(slug)) {
      k += 1
      slug = `${base}-${k}`
    }
    taken.add(slug)
    return slug
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const match = line.match(/^(#{1,5})\s+(.+)$/)
    if (!match) continue

    const level = match[1].length
    const rawTitle = match[2].trim()

    // 跳过文章第一个顶级 H1 标题（通常是文件总标题）
    if (level === 1 && !foundFirstH1) {
      foundFirstH1 = true
      continue
    }

    // 忽略目录自身的标题
    //
    // 修复记录（2026-10-23，第 54 项放行轮 / 账本 §4.70）：原判据用**子串**匹配
    // `(?:章节速查|目录|导引|Table of Contents|TOC)`，凡标题里出现「目录」二字即被误吞
    // —— 本仓账文里有 3 条真标题因此静默消失、目录少 3 行且无任何告警：
    // §4.37「…目录冗余已删」、§4.37 第 10 小节「并发笔把目录副本复活了 320 行」、
    // §4.59「…目录真值备份三处失实」（复算式 = `grep -n '^#\{2,4\} ' <doc> | grep -e 目录 -e 导引`）。
    // ⇒ 收窄为 TOC_TITLE_RE：**只有以目录关键词开头**的标题才算目录自身。
    if (TOC_TITLE_RE.test(rawTitle)) {
      continue
    }

    if (level <= maxDepth) {
      const slug = anchorOf(generateGithubSlug(rawTitle))
      if (slug) {
        headings.push({
          level,
          title: rawTitle,
          slug,
          lineNum: i + 1
        })
      }
    }
  }

  return headings
}

// 构建目录导航 Markdown 文本
function buildTocMarkdown(headings) {
  if (headings.length === 0) return ''

  const lines = [
    '## 章节速查 (Table of Contents)',
    '',
    '> 💡 **Agent 快速查阅指引**：查阅深度规范时，请先检索本目录导航快速定位章节与行号，定向读取指定范围，避免无脑全量拉取。',
    ''
  ]

  // 计算最小层级作为基准缩进
  const minLevel = Math.min(...headings.map(h => h.level))

  for (const h of headings) {
    const indentLevel = Math.max(0, h.level - minLevel)
    const indent = '  '.repeat(indentLevel)
    lines.push(`${indent}- [${h.title}](#${h.slug})`)
  }

  lines.push('')
  lines.push('---')
  lines.push('')

  return lines.join('\n')
}

// 计算插入 TOC 的最佳行位置
function findTocInsertionIndex(lines) {
  let inFrontmatter = false
  let frontmatterEnd = -1

  for (let i = 0; i < Math.min(lines.length, 30); i++) {
    const line = lines[i].trim()
    if (i === 0 && line === '---') {
      inFrontmatter = true
      continue
    }
    if (inFrontmatter && line === '---') {
      frontmatterEnd = i
      break
    }
  }

  let startLine = frontmatterEnd !== -1 ? frontmatterEnd + 1 : 0

  // 寻找首个 H1 标题
  let firstH1Index = -1
  for (let i = startLine; i < Math.min(lines.length, 40); i++) {
    if (/^#\s+/.test(lines[i].trim())) {
      firstH1Index = i
      break
    }
  }

  if (firstH1Index === -1) {
    return startLine
  }

  // 检查首个 H1 后是否有导言分隔线 ---
  for (let i = firstH1Index + 1; i < Math.min(lines.length, 50); i++) {
    const line = lines[i].trim()
    if (line === '---') {
      return i + 1
    }
  }

  // 若无分隔线，寻找首个非引用、非空行的段落结束处，或紧跟首个 H1 的下方空行处
  let targetIndex = firstH1Index + 1
  while (targetIndex < lines.length && (lines[targetIndex].trim().startsWith('>') || lines[targetIndex].trim() === '')) {
    targetIndex++
  }

  return targetIndex
}

// 定位已有 TOC 的行范围 [start, end)
//
// 修复记录（2026-10-23，第 54 项放行轮 / 账本 §4.70）：原实现有两处窗口截断
// （起点只搜前 80 行、终点只搜到第 120 行），并且把「第一条 `---`」当作目录结束。
// 对目录条目很多的长文必然失效（本仓账文前态：首块目录 357 行，其结束线远在 120 行窗口之外）：
// 终点循环走不到 `---`，`endIndex` 停在 `startIndex + 1` ⇒ 每次运行**只替换目录标题行本身**，
// 旧条目整块留在原地 ⇒ 每次多出一份目录副本（账文前态实测已堆到 15 份／4787 行目录条目）。
// 这就是 §4.37 第 10 小节「并发笔把目录副本复活了 320 行」的真复活源 —— 归因已由"并发笔"更正为"本工具"。
// ⇒ 改为：起点全文件搜索；终点向后吞并**连续的目录形态行**直到遇到正文标题或非目录内容为止
// （因此陈旧副本可被一次收干）；区间尾部的分隔线与空行一并纳入区间，由 buildTocMarkdown 重新生成。
function findExistingTocRange(lines) {
  let startIndex = -1
  for (let i = 0; i < lines.length; i++) {
    if (TOC_HEAD_RE.test(lines[i].trim())) {
      startIndex = i
      break
    }
  }

  if (startIndex === -1) return null

  let endIndex = startIndex + 1
  for (let i = startIndex + 1; i < lines.length; i++) {
    const line = lines[i]
    const t = line.trim()
    // 遇到正文标题 ⇒ 目录区到此为止
    if (/^#{1,6}\s+/.test(t) && !TOC_HEAD_RE.test(t)) {
      endIndex = i
      break
    }
    // 混入非目录形态内容 ⇒ 保守止步，绝不越界删除
    if (!isTocRegionLine(line)) {
      endIndex = i
      break
    }
    endIndex = i + 1
  }

  // 区间**含**目录区尾部的分隔线与空行：新块自带 `---` 与后置空行，
  // 若把它们留在原地则每次运行都会多叠一条分隔线（破坏幂等）。
  return { start: startIndex, end: endIndex }
}

// Windows 兼容安全写入，具备瞬时占用重试机制
function safeWriteFileSync(filePath, content) {
  let attempts = 0
  while (true) {
    try {
      fs.writeFileSync(filePath, content, 'utf-8')
      break
    } catch (err) {
      attempts++
      if (attempts >= 5) {
        throw err
      }
      const start = Date.now()
      while (Date.now() - start < 50 * attempts) {}
    }
  }
}

// 为单个文件生成或覆盖更新 TOC
function processFile(filePath, options = {}) {
  const { checkOnly = false, maxDepth = 4 } = options
  const relPath = path.relative(ROOT_DIR, filePath).replace(/\\/g, '/')

  if (!fs.existsSync(filePath)) {
    console.error(`❌ 文件不存在: ${relPath}`)
    return false
  }

  const rawContent = fs.readFileSync(filePath, 'utf-8')
  const isCrlf = rawContent.includes('\r\n')
  const newline = isCrlf ? '\r\n' : '\n'
  const lines = rawContent.split(/\r?\n/)

  const existingRange = findExistingTocRange(lines)

  const headings = extractHeadings(rawContent, maxDepth)
  if (headings.length < 2) {
    // 修复记录（2026-10-24，第 60 项 / 账本 §4.74）：此早退原本直接 `return true`，且发生在
    // `checkOnly` 分支与覆盖分支**之前** ⇒「标题数不足却仍挂着目录块」的文档跑本工具永远逐字节
    // 零变化，块里指向已删除章节的死锚没有任何工具路径能清除（本仓实测实例 = `docs/features/ai/README.md`）。
    // 本口径下「标题过少的文档不维护目录」是既有规则，故那个块属违规残骸 ⇒
    // 删除它是**执行现行口径**，不是变更口径；只删 `findExistingTocRange()` 认出的块，绝不越界。
    if (checkOnly) {
      if (existingRange) {
        console.log(`⚠️  [陈旧目录] ${relPath} (标题数 ${headings.length} 不足 2，文内仍挂目录块于行 ${existingRange.start + 1}~${existingRange.end} ⇒ 需重刷)`)
        return false
      }
      return true
    }
    if (existingRange) {
      const removed = existingRange.end - existingRange.start
      const newLines = [...lines.slice(0, existingRange.start), ...lines.slice(existingRange.end)]
      const newContent = newLines.join(newline)
      if (newContent !== rawContent) {
        safeWriteFileSync(filePath, newContent)
        console.log(`🧹 [删除陈旧目录] ${relPath} (标题数 ${headings.length} 不足 2，原行 ${existingRange.start + 1}~${existingRange.end} 共 ${removed} 行目录块已收干)`)
      }
      return true
    }
    if (options.verbose) {
      console.log(`⏩ [标题过少] ${relPath} 标题数不足，无需添加目录导航`)
    }
    return true
  }

  if (checkOnly) {
    if (!existingRange) {
      console.log(`⚠️  [缺失目录] ${relPath} (共 ${headings.length} 个小节，未配备目录导航)`)
      return false
    }
    return true
  }

  const tocText = buildTocMarkdown(headings)
  let newLines
  let actionLog = ''

  if (existingRange) {
    // 总是覆盖更新已有 TOC，确保标题和行号永远与最新内容 100% 同步
    newLines = [
      ...lines.slice(0, existingRange.start),
      ...tocText.split('\n'),
      ...lines.slice(existingRange.end)
    ]
    actionLog = `🔄 [覆盖更新目录] ${relPath} (原行 ${existingRange.start + 1}~${existingRange.end} 已刷新为最新 ${headings.length} 项目录)`
  } else {
    const insertIndex = findTocInsertionIndex(lines)
    newLines = [
      ...lines.slice(0, insertIndex),
      ...tocText.split('\n'),
      ...lines.slice(insertIndex)
    ]
    actionLog = `✅ [新增目录导航] ${relPath} (于行 ${insertIndex + 1} 成功插入 ${headings.length} 项目录)`
  }

  const newContent = newLines.join(newline)
  if (newContent === rawContent) {
    // 内容未变化，幂等跳过写入磁盘，防 Windows 高并发写文件占用冲突
    return true
  }

  console.log(actionLog)
  safeWriteFileSync(filePath, newContent)
  return true
}

// 递归扫描 Markdown 文件
function scanMarkdownFiles(dir, fileList = []) {
  if (!fs.existsSync(dir)) return fileList
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (['node_modules', '.git', 'dist', 'build', '.scratch'].includes(entry.name)) {
        continue
      }
      scanMarkdownFiles(fullPath, fileList)
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      fileList.push(fullPath)
    }
  }
  return fileList
}

// 主入口
function main() {
  const args = process.argv.slice(2)
  const force = args.includes('--force') || args.includes('-f')
  const checkOnly = args.includes('--check')
  const isAll = args.includes('--all')
  const verbose = args.includes('--verbose') || args.includes('-v')

  // 未知旗标 fail-loud 守卫（必须先于任何扫描/写盘分支）：
  // 本函数原先对白名单之外的旗标采取「静默忽略」策略，后果是拼错或多余的旗标不会报错，
  // 而是让流程继续走到「无位置参数 ⇒ 全库扫描 docs/ 并写盘」的默认分支，把一次定点请求
  // 放大成对无关文档的 collateral 改写。现改为显式上报并以 exit(2) 阻断：任何以 `-` 开头
  // 且不在下方白名单内的参数，都在进入 targetArg 解析与 scanMarkdownFiles 之前直接终止。
  // 已知合法调用面（现读自 package.json 的 docs:toc / docs:toc:check、本仓各文档与
  // workflows/long-doc-landing-and-clean-commit.md 的成文用法）仅三种：无参数、`--check`、
  // 位置参数（文件/目录路径），本守卫对其零影响；`require()` 本文件取真函数的用法由下方
  // require.main 判定保护，不经过 main()，同样不受影响。
  const KNOWN_FLAGS = new Set(['--force', '-f', '--check', '--all', '--verbose', '-v'])
  const unknownFlags = args.filter(arg => arg.startsWith('-') && !KNOWN_FLAGS.has(arg))
  if (unknownFlags.length > 0) {
    console.error(
      `❌ 存在未知旗标: ${unknownFlags.join(', ')}；` +
        `本工具只认 ${[...KNOWN_FLAGS].join(' / ')}，位置参数为文件或目录路径。` +
        `已阻断执行（未扫描、未写盘）。`
    )
    process.exit(2)
  }

  const targetArg = args.find(a => !a.startsWith('-'))

  let targetFiles = []

  if (targetArg) {
    const resolvedPath = path.resolve(process.cwd(), targetArg)
    if (fs.existsSync(resolvedPath)) {
      const stat = fs.statSync(resolvedPath)
      if (stat.isDirectory()) {
        targetFiles = scanMarkdownFiles(resolvedPath)
      } else if (stat.isFile() && resolvedPath.endsWith('.md')) {
        targetFiles = [resolvedPath]
      }
    } else {
      console.error(`❌ 指定路径不存在: ${targetArg}`)
      process.exit(1)
    }
  } else {
    // 默认全量扫描 docs/ 下全部活跃技术文档 (排除 docs/archive)
    targetFiles = scanMarkdownFiles(path.join(ROOT_DIR, 'docs'))
  }

  console.log(`\n======================================================`)
  console.log(`📑 自动化 Markdown 目录导航 (TOC) 工具`)
  console.log(`模式: ${checkOnly ? '仅检查 (Check)' : '检测并写入 (Generate)'} | 目标数: ${targetFiles.length}`)
  console.log(`======================================================\n`)

  let processedCount = 0
  let missingCount = 0

  for (const file of targetFiles) {
    // 排除已归档的旧历史任务
    if (file.includes('docs\\archive') || file.includes('docs/archive')) continue

    const ok = processFile(file, { force, checkOnly, verbose })
    if (ok) processedCount++
    else missingCount++
  }

  console.log(`\n------------------------------------------------------`)
  console.log(`📊 统计结果: 处理/通过: ${processedCount} | 缺失/未加: ${missingCount}`)
  console.log(`======================================================\n`)
}

if (require.main === module) {
  main()
}

module.exports = {
  extractHeadings,
  hasExistingToc,
  buildTocMarkdown,
  processFile
}
