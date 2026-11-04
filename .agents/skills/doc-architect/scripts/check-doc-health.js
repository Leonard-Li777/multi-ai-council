#!/usr/bin/env node
/**
 * .agents/skills/doc-architect/scripts/check-doc-health.js
 *
 * 4 环知识拓扑架构自动化健康度与防腐门禁检查器 (v2.0 深度增强版)
 *
 * 核心检查项：
 * 1. L1 (AGENTS.md) 行数配额门禁 (默认 <= 120 行)
 * 2. 全文档本地 Markdown 超链接物理存在性 + #anchor 章节锚点真实性校验 (零死链、零死锚)
 * 3. 4 环拓扑异环严格相邻原则 (Inter-ring Strict Adjacency: L1 <-> L2 <-> L3 <-> L4，严禁跳级跨环)
 * 4. L3 深度技术规格前 60 行 TOC 导航强制检查与语义废弃 (SUPERSEDED) 继任链接检查
 */

const fs = require('fs')
const path = require('path')

const ROOT_DIR = path.resolve(__dirname, '../../../../')
const AGENTS_MD_PATH = path.join(ROOT_DIR, 'AGENTS.md')
const MAX_L1_LINES = 120

// 缓存已解析文件的标题锚点集合，避免重复 IO 与重复计算
const fileAnchorCache = new Map()

// 环级判定规则 (针对知识体系 Markdown 文档)
function classifyRing(filePath) {
  const relPath = path.relative(ROOT_DIR, filePath).replace(/\\/g, '/')

  // 第 1 环 (L1): 系统不可动摇内核总枢
  if (relPath === 'AGENTS.md' || relPath === 'CLAUDE.md') {
    return { ring: 1, name: 'L1 (Kernel)' }
  }

  // 第 2 环 (L2): 领域规范与枢纽 (Standards & Hubs)
  if (
    relPath.startsWith('docs/developer/standards/') ||
    relPath.startsWith('docs/developer/infra/') ||
    relPath.startsWith('docs/developer/architecture/') ||
    relPath.startsWith('docs/developer/references/') ||
    relPath.startsWith('docs/features/') ||
    relPath.startsWith('docs/agents/')
  ) {
    return { ring: 2, name: 'L2 (Standards & Hubs)' }
  }

  // 第 3 环 (L3): 深度技术规格书与 PRD (Deep Specs & PRDs)
  if (
    relPath.startsWith('docs/specs/') ||
    relPath.startsWith('docs/prd/') ||
    relPath.startsWith('docs/adr/')
  ) {
    return { ring: 3, name: 'L3 (Deep Specs & PRDs)' }
  }

  // 第 4 环 (L4): 语境、复盘与历史 (Context & History)
  if (
    relPath.startsWith('docs/archive/') ||
    relPath.startsWith('docs/research/') ||
    relPath.startsWith('docs/issues/') ||
    relPath.startsWith('docs/retro/')
  ) {
    return { ring: 4, name: 'L4 (Context & History)' }
  }

  return { ring: 0, name: 'Other/Unclassified' }
}

// 递归扫描 Markdown 文件 (支持排除指定子目录)
function scanMarkdownFiles(dir, fileList = [], excludeDirs = []) {
  if (!fs.existsSync(dir)) return fileList
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (['node_modules', '.git', 'dist', 'build', '.scratch', ...excludeDirs].includes(entry.name)) {
        continue
      }
      scanMarkdownFiles(fullPath, fileList, excludeDirs)
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      fileList.push(fullPath)
    }
  }
  return fileList
}

const FENCE_MARK_RE = /^(`{3,})(.*)$/

/**
 * 严格 CommonMark 围栏长度栈配对剥离代码块
 * 与 generate-doc-toc.js 保持同源严格实现
 */
function stripFencedCodeBlocks(content) {
  const lines = content.split(/\r?\n/)
  const outLines = []
  const stack = []

  for (const line of lines) {
    const m = FENCE_MARK_RE.exec(line)
    if (!m) {
      outLines.push(stack.length ? '' : line)
      continue
    }
    const len = m[1].length
    const info = m[2]
    if (stack.length && len >= stack[stack.length - 1] && info.trim() === '') {
      stack.pop()
      outLines.push('')
      continue
    }
    if (!stack.length && !info.includes('`')) {
      stack.push(len)
    }
    outLines.push('')
  }
  return outLines.join('\n')
}

// 目录类关键词（用于识别「目录块」候选标题）
// 口径说明：比生成器的 TOC_TITLE_RE 更宽——生成器只认「以关键词起头」的标题，
// 而此处要抓的是「标题里带目录二字」的盲区候选，必须能命中形如
// 「章节速查导引 (Table of Contents)」「📑 章节目录与核心锚点导航 (TOC)」这类标题。
const TOC_KEYWORD_RE = /(?:Table of Contents|章节速查|目录|导引|TOC)/i
// 文档内锚链接（目录块的实际内容特征）
const INTRA_ANCHOR_RE = /\[[^\]]+\]\(#[^)]+\)/g
// 目录维护盲区判定阈值：块内锚链接少于该数视为业务正文提及「目录」二字，不计盲区
const TOC_BLINDSPOT_MIN_ANCHORS = 3

/**
 * 从生成器源码抽取 TOC_HEAD_RE 唯一正尺（避免两处正则漂移）。
 *
 * 背景：生成器 generate-doc-toc.js 是「目录维护能力」的定义方——
 * 只有它能识别的目录块才会被刷新/清理，识别不到的既不刷新也不清理，
 * 即「目录维护盲区」。因此判定盲区必须以生成器的正尺为准，而非本文件另写一份。
 *
 * @returns {{re: RegExp|null, reason: string|null}} 抽取失败时返回原因（显式上报，禁止静默降级）
 */
function loadGeneratorTocHeadRe() {
  const genPath = path.join(__dirname, 'generate-doc-toc.js')
  if (!fs.existsSync(genPath)) {
    return { re: null, reason: `生成器文件不存在: ${path.relative(ROOT_DIR, genPath)}` }
  }
  const src = fs.readFileSync(genPath, 'utf-8')
  const line = src.split(/\r?\n/).find(l => l.includes('const TOC_HEAD_RE ='))
  if (!line) {
    return { re: null, reason: '生成器源码中未找到 TOC_HEAD_RE 定义' }
  }
  const literal = line.slice(line.indexOf('=') + 1).trim().replace(/;\s*$/, '')
  try {
    const re = new Function(`return (${literal})`)()
    if (!(re instanceof RegExp)) {
      return { re: null, reason: '抽取到的 TOC_HEAD_RE 不是正则字面量' }
    }
    return { re, reason: null }
  } catch (e) {
    return { re: null, reason: `TOC_HEAD_RE 字面量求值失败: ${e.message}` }
  }
}

/**
 * 检出「目录维护盲区」：文件内存在目录型标题块，但该标题不被生成器正尺识别，
 * 于是 `pnpm run docs:toc` 既不会刷新它、也不会清理它 —— 目录与正文持续漂移。
 *
 * 判据链：
 *   ① 标题为 H2+（H1 是文档主标题，不是目录块）
 *   ② 标题正文含目录类关键词
 *   ③ 该标题行不被生成器正尺 TOC_HEAD_RE 识别
 *   ④ 其后块体（止于任意层级的下一标题）含 ≥3 条文档内锚链接 [..](#..)
 *      —— 用以把「业务标题里带『目录』二字」与「确为目录导航块」区分开
 *
 * @param {string} cleanContent 已剥离围栏代码块的内容
 * @param {RegExp} tocHeadRe 生成器正尺
 * @returns {Array<{title: string, line: number, anchors: number}>}
 */
function findTocBlindSpots(cleanContent, tocHeadRe) {
  const lines = cleanContent.split(/\r?\n/)
  const heads = []
  for (let i = 0; i < lines.length; i++) {
    const m = /^(#{1,6})\s+(.*)$/.exec(lines[i])
    if (m) heads.push({ level: m[1].length, title: m[2].trim(), lineNo: i + 1 })
  }

  const spots = []
  for (let h = 0; h < heads.length; h++) {
    const cur = heads[h]
    if (cur.level < 2) continue
    if (!TOC_KEYWORD_RE.test(cur.title)) continue
    // 与生成器 findExistingTocRange 同源判定：trim 后再测正尺
    if (tocHeadRe.test(lines[cur.lineNo - 1].trim())) continue // 生成器可维护 → 非盲区

    // 块体：从标题下一行到下一个【任意层级】标题（目录块内不会再嵌标题）
    let end = lines.length
    for (let k = h + 1; k < heads.length; k++) {
      end = heads[k].lineNo - 1
      break
    }
    const body = lines.slice(cur.lineNo, end).join('\n')
    const anchorHits = body.match(INTRA_ANCHOR_RE) || []
    if (anchorHits.length < TOC_BLINDSPOT_MIN_ANCHORS) continue
    spots.push({ title: cur.title, line: cur.lineNo, anchors: anchorHits.length })
  }
  return spots
}

/**
 * 统一相对路径为正斜杠形式（Windows 下 path.sep 是反斜杠，此处不写死分隔符字面量）。
 */
function toPosixRelPath(absPath) {
  return path.relative(ROOT_DIR, absPath).split(path.sep).join('/')
}

/**
 * 扫描「目录维护盲区」，扫描面严格对齐生成器 `docs:toc` 的处理面。
 *
 * 口径说明（与 generate-doc-toc.js 同源）：
 *   · 生成器默认扫描 `docs/` 全量，排除 node_modules/.git/dist/build/.scratch；
 *   · 生成器在处理循环里**跳过 `docs/archive`**；
 *   · 生成器默认**不处理 AGENTS.md**（只有显式传入目标路径才会）。
 * 因此盲区面必须与之一致——若改挂在本门禁的 targetFiles 上，同一份代码在
 * 「默认模式」与「--all 模式」下会给出不同的盲区数（口径随行，读数不可比）。
 *
 * @param {RegExp} tocHeadRe 生成器正尺
 * @returns {Array<{file: string, blocks: Array<{title: string, line: number, anchors: number}>}>}
 */
function scanTocBlindSpots(tocHeadRe) {
  const files = scanMarkdownFiles(path.join(ROOT_DIR, 'docs')).filter(f => {
    const rel = toPosixRelPath(f)
    return !rel.startsWith('docs/archive/')
  })

  const hits = []
  for (const file of files) {
    const content = stripFencedCodeBlocks(fs.readFileSync(file, 'utf-8'))
    const blocks = findTocBlindSpots(content, tocHeadRe)
    if (blocks.length > 0) {
      hits.push({ file: toPosixRelPath(file), blocks })
    }
  }
  return hits
}

/**
 * 计算行内代码 (inline code span) 的字符区间，供链接扫描时跳过。
 *
 * 依据：CommonMark 行内代码用等长反引号串配对（`` ` `` 与 ``` `` ``` 不同长度互不配对），
 * 且不允许跨行。行内代码内的 `[]()` 在任何渲染器（GitHub / VS Code / Typora）里都渲染为
 * 字面文本而非链接，因此不得计入死链/死锚/跨环判定——这类命中是纯误报（文档在举例说明
 * 链接语法时必然出现）。
 *
 * 注意：此处只做「区间跳过」，不改写文本。任何文本替换方案都会因反引号消失而让原本被
 * 隔断的 `[` 与 `](` 拼接成新链接，从而制造新的假阳性。
 */
function getInlineCodeRanges(content) {
  const ranges = []
  const openers = /(`+)/g
  let m
  while ((m = openers.exec(content)) !== null) {
    const runLen = m[1].length
    const start = m.index
    const closers = /(`+)/g
    closers.lastIndex = start + runLen
    let m2
    let end = -1
    while ((m2 = closers.exec(content)) !== null) {
      if (m2[1].length !== runLen) continue
      // 行内代码不跨行
      if (content.slice(start + runLen, m2.index).includes('\n')) break
      end = m2.index + runLen
      break
    }
    if (end === -1) continue
    ranges.push([start, end])
    openers.lastIndex = end
  }
  return ranges
}

/** 判断某个字符位置是否落在任一区间内 */
function isInsideRanges(ranges, pos) {
  for (const [s, e] of ranges) {
    if (pos >= s && pos < e) return true
  }
  return false
}

/**
 * 唯一正尺：GitHub 渲染实态 Slug 生成算法 (与 generate-doc-toc.js 严格同源)
 */
function generateGithubSlug(rawHeadingText) {
  return rawHeadingText
    .trim()
    .toLowerCase()
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // 剥离标题内 Markdown 链接，只取显示文本
    .replace(/[`*~]/g, '') // 剥离反引号、星号、波浪号（保留下划线）
    .replace(/[^\p{L}\p{N}\s\-_]/gu, '') // 保留 Unicode 字母、数字、中文、空格、下划线、连字符
    .replace(/\s/g, '-') // 每个空白字符各自转为连字符 `-`，不折叠连续 `-`，不去首尾 `-`
}

/**
 * 提取目标 Markdown 文件内所有合法的 #anchor 集合 (支持同名递推 -1, -2)
 */
function getFileAnchors(filePath) {
  if (fileAnchorCache.has(filePath)) {
    return fileAnchorCache.get(filePath)
  }
  if (!fs.existsSync(filePath) || !filePath.endsWith('.md')) {
    return new Set()
  }

  const raw = fs.readFileSync(filePath, 'utf-8')
  const clean = stripFencedCodeBlocks(raw)
  const lines = clean.split('\n')
  const usedSlugs = new Set()

  for (const line of lines) {
    const m = line.match(/^(#{1,6})\s+(.+?)\s*$/)
    if (!m) continue
    // 剥离行尾可能残留的闭井号 ###
    const headingText = m[2].replace(/\s+#+\s*$/, '')
    const baseSlug = generateGithubSlug(headingText)
    if (!baseSlug) continue

    let candidate = baseSlug
    let counter = 1
    while (usedSlugs.has(candidate)) {
      candidate = `${baseSlug}-${counter}`
      counter++
    }
    usedSlugs.add(candidate)
  }

  fileAnchorCache.set(filePath, usedSlugs)
  return usedSlugs
}

// 解析链接地址为 { targetPath, anchor }
function resolveTargetAndAnchor(rawLink, sourceFile) {
  let cleanLink = rawLink.trim()
  cleanLink = cleanLink.replace(/\s+["'][^"']*["']$/, '')

  if (cleanLink.startsWith('file:///')) {
    cleanLink = cleanLink.slice(8)
    if (/^[a-zA-Z]:\//.test(cleanLink)) {
      cleanLink = cleanLink.replace(/\//g, '\\')
    }
  }

  const hashIndex = cleanLink.indexOf('#')
  const pathPart = hashIndex !== -1 ? cleanLink.slice(0, hashIndex) : cleanLink
  const anchorPart = hashIndex !== -1 ? cleanLink.slice(hashIndex + 1) : null

  // 页内纯锚点跳转 (#section)
  if (!pathPart && anchorPart) {
    return { targetPath: sourceFile, anchor: decodeURIComponent(anchorPart) }
  }
  if (!pathPart) return null

  const sourceDir = path.dirname(sourceFile)
  const resolvedPath = pathPart.startsWith('/')
    ? path.join(ROOT_DIR, pathPart.slice(1))
    : path.resolve(sourceDir, pathPart)

  let decodedAnchor = anchorPart
  try {
    if (anchorPart) decodedAnchor = decodeURIComponent(anchorPart)
  } catch (_) {
    // 保持原样
  }

  return { targetPath: resolvedPath, anchor: decodedAnchor }
}

function checkDocHealth() {
  console.log(`\n======================================================`)
  console.log(`🛡️  4 环知识拓扑架构自生长与防腐门禁检查器 (v2.0)`)
  console.log(`======================================================\n`)

  let hasFatalError = false
  const warnings = []
  const errors = []

  // 1. 检查 L1 (AGENTS.md) 行数配额
  if (!fs.existsSync(AGENTS_MD_PATH)) {
    errors.push(`[L1 缺失] 未在根目录下找到 AGENTS.md`)
    hasFatalError = true
  } else {
    const l1Content = fs.readFileSync(AGENTS_MD_PATH, 'utf-8')
    const l1Lines = l1Content.split(/\r?\n/).length
    console.log(`📏 [L1 配额检查] AGENTS.md 当前行数: ${l1Lines} 行 (配额上限: ${MAX_L1_LINES} 行)`)
    if (l1Lines > MAX_L1_LINES) {
      warnings.push(`[L1 膨胀预警] AGENTS.md 行数 (${l1Lines}) 超过预算上限 (${MAX_L1_LINES})，请将具体细节下沉至 L2/L3！`)
    } else {
      console.log(`   ✅ L1 行数在预算配额内，保持极简常驻开销！\n`)
    }
  }

  // 1.1 检查核心技能寻航门禁 (Doc-Radar Gate)
  const CORE_RADAR_SKILLS = ['tdd', 'diagnosing-bugs', 'implement', 'implement-loop', 'plan-loop']
  for (const skillName of CORE_RADAR_SKILLS) {
    const skillPath = path.join(ROOT_DIR, '.agents/skills', skillName, 'SKILL.md')
    if (!fs.existsSync(skillPath)) {
      errors.push(`[核心技能缺失] 未找到核心技能定义: .agents/skills/${skillName}/SKILL.md`)
      hasFatalError = true
      continue
    }
    const skillContent = fs.readFileSync(skillPath, 'utf-8')
    if (!skillContent.includes('doc-radar.js')) {
      errors.push(`[技能寻航逃逸] 核心技能 .agents/skills/${skillName}/SKILL.md 未植入 doc-radar.js 寻航门禁！`)
      hasFatalError = true
    }
  }
  console.log(`🧭 [技能寻航门禁] ${CORE_RADAR_SKILLS.length} 个核心开发技能均已成功锚定 doc-radar.js！\n`)

  // 2. 收集需要审查的文档集
  const docsDir = path.join(ROOT_DIR, 'docs')
  const checkAll = process.argv.includes('--all')
  const verifyAnchors = !process.argv.includes('--no-anchors')

  const coreL2Files = [
    path.join(ROOT_DIR, 'docs/developer/architecture/v4-end-to-end-architecture.md'),
    path.join(ROOT_DIR, 'docs/developer/standards/controlled-concepts-guide.md'),
    path.join(ROOT_DIR, 'docs/developer/standards/git-concurrency-workflow.md'),
    path.join(ROOT_DIR, 'docs/developer/standards/testing-guide.md'),
    path.join(ROOT_DIR, 'docs/developer/standards/path-normalization-guideline.md'),
    path.join(ROOT_DIR, 'docs/developer/infra/port-and-debug-standards.md'),
    path.join(ROOT_DIR, 'docs/developer/infra/DEVELOPMENT.md'),
    path.join(ROOT_DIR, 'docs/developer/architecture/project-structure-and-pro.md'),
    path.join(ROOT_DIR, 'docs/developer/architecture/application-phases-definition.md'),
    path.join(ROOT_DIR, 'docs/developer/architecture/preset-resources-distribution-pipeline.md'),
    path.join(ROOT_DIR, 'docs/features/file-management/virtual-directory-guide.md'),
    path.join(ROOT_DIR, 'docs/features/ui/voerkai18n-usage-guide.md'),
    path.join(ROOT_DIR, 'docs/developer/references/public-services-catalog.md'),
    path.join(ROOT_DIR, 'docs/agents/issue-tracker.md')
  ]

  let targetFiles = []
  if (checkAll) {
    targetFiles = scanMarkdownFiles(docsDir, [AGENTS_MD_PATH], [])
  } else {
    // 全覆盖 L1 + 核心 L2 + 全量 L3 (specs / prd / adr) + 活跃 L4 retro
    targetFiles = [
      AGENTS_MD_PATH,
      ...coreL2Files,
      ...scanMarkdownFiles(path.join(ROOT_DIR, 'docs/specs')),
      ...scanMarkdownFiles(path.join(ROOT_DIR, 'docs/prd')),
      ...scanMarkdownFiles(path.join(ROOT_DIR, 'docs/adr')),
      ...scanMarkdownFiles(path.join(ROOT_DIR, 'docs/retro'))
    ]
  }
  targetFiles = Array.from(new Set(targetFiles)).filter(fs.existsSync)

  console.log(`📚 检查目标集: ${targetFiles.length} 篇知识体系文档 (${checkAll ? '全量归档模式' : 'L1 + L2 核心 Hub + 全量 L3 + L4 Retro'})...`)

  let totalLinksChecked = 0
  let deadLinksCount = 0
  let deadAnchorsCount = 0
  let topologyViolations = 0

  // 目录维护盲区（信息项，不进入 warning / error 判定面，不影响退出码）
  const tocHeadRe = loadGeneratorTocHeadRe()
  let tocBlindSpotFiles = []
  if (!tocHeadRe.re) {
    // 显式上报降级原因，禁止静默跳过（见 AGENTS.md §2.9 禁止静默降级）
    console.warn(`⚠️  目录维护盲区检测已跳过：${tocHeadRe.reason}（本项为信息项，不影响门禁退出码）`)
  } else {
    tocBlindSpotFiles = scanTocBlindSpots(tocHeadRe.re)
  }

  const linkRegex = /(?<!\!)\[([^\]]+)\]\(([^)]+)\)/g

  for (const docFile of targetFiles) {
    const relSource = path.relative(ROOT_DIR, docFile).replace(/\\/g, '/')
    const sourceRingInfo = classifyRing(docFile)
    const rawContent = fs.readFileSync(docFile, 'utf-8')

    // L3 结构规范校验：前 60 行强制包含 TOC 章节速查表 (排除简短 ADR)
    if (sourceRingInfo.ring === 3 && !relSource.startsWith('docs/adr/')) {
      const lines = rawContent.split(/\r?\n/)
      if (lines.length > 80) {
        const first60Lines = lines.slice(0, 60).join('\n')
        const hasToc = /(?:Table of Contents|章节速查|目录|TOC)/i.test(first60Lines)
        if (!hasToc) {
          warnings.push(`[L3 缺失 TOC] 深度技术规格 ${relSource} 超过 80 行但前 60 行未检测到标准 TOC 章节速查表（请运行 pnpm run docs:toc）！`)
        }
      }
    }

    const cleanContent = stripFencedCodeBlocks(rawContent)
    // 行内代码区间：其中的 []() 是字面文本，不是渲染链接，必须跳过（详见 getInlineCodeRanges 注释）
    const inlineCodeRanges = getInlineCodeRanges(cleanContent)

    // 防腐标头检查
    if (sourceRingInfo.ring !== 4 && (cleanContent.includes('SUPERSEDED') || cleanContent.includes('已废弃'))) {
      if (!cleanContent.includes('http') && !/\[.*?\]\(.*?\)/.test(cleanContent)) {
        warnings.push(`[防腐指针缺失] ${relSource} 标记了废弃/SUPERSEDED，但未提供继任新规范链接！`)
      }
    }

    let match
    while ((match = linkRegex.exec(cleanContent)) !== null) {
      const linkText = match[1]
      const rawLink = match[2].trim()

      // 行内代码内的 []() 是字面文本示例，不计入任何链接判定
      if (isInsideRanges(inlineCodeRanges, match.index)) {
        continue
      }

      if (/^(https?:\/\/|mailto:|ftp:|tel:|javascript:)/i.test(rawLink)) {
        continue
      }

      // 过滤非链接的正文字符串/正则表达式误匹配 (如 ['\"](未归类|未知) 或占位符 (url))
      if (rawLink === 'url' || rawLink.includes('|') || rawLink.includes('"') || rawLink.includes("'") || rawLink.includes('\\') || rawLink.includes('\n')) {
        continue
      }

      const resolved = resolveTargetAndAnchor(rawLink, docFile)
      if (!resolved) continue

      const { targetPath, anchor } = resolved
      totalLinksChecked++

      // 2.1 物理文件存在性检查
      if (!fs.existsSync(targetPath)) {
        if (targetPath.endsWith('.md')) {
          deadLinksCount++
          errors.push(
            `[死链错误] ${relSource} 存在失效文档链接:\n   ➔ [${linkText}](${rawLink})\n   ➔ 物理目标不存在: ${path.relative(ROOT_DIR, targetPath)}`
          )
          hasFatalError = true
          continue
        } else {
          warnings.push(
            `[源码引用预警] ${relSource} 引用的源码/资源文件当前不存在:\n   ➔ [${linkText}](${rawLink})\n   ➔ 路径: ${path.relative(ROOT_DIR, targetPath)}`
          )
          continue
        }
      }

      // 2.2 章节 #anchor 真实性校验
      if (verifyAnchors && anchor && targetPath.endsWith('.md')) {
        const validAnchors = getFileAnchors(targetPath)
        const normalizedAnchor = anchor.toLowerCase()
        if (!validAnchors.has(normalizedAnchor)) {
          deadAnchorsCount++
          const relTarget = path.relative(ROOT_DIR, targetPath).replace(/\\/g, '/')
          warnings.push(
            `[死锚预警] ${relSource} 指向了不存在的章节锚点:\n   ➔ [${linkText}](${rawLink})\n   ➔ 目标文件 ${relTarget} 中未找到锚点 "#${anchor}" (建议运行 pnpm run docs:toc 同步)`
          )
        }
      }

      // 2.3 异环拓扑合法性检验
      if (targetPath !== docFile && targetPath.endsWith('.md')) {
        const targetRingInfo = classifyRing(targetPath)
        if (sourceRingInfo.ring > 0 && targetRingInfo.ring > 0) {
          const ringDiff = Math.abs(sourceRingInfo.ring - targetRingInfo.ring)
          if (ringDiff > 1) {
            topologyViolations++
            warnings.push(
              `[拓扑跨环穿透] ${relSource} (${sourceRingInfo.name}) 越级直连了 ${path.relative(ROOT_DIR, targetPath).replace(/\\/g, '/')} (${targetRingInfo.name})，跨越了 ${ringDiff} 环！\n   ➔ 拓扑契约：异环仅限相邻单级串联 (L1 <-> L2 <-> L3 <-> L4)。`
            )
          }
        }
      }
    }
  }

  // 3. 输出汇总统计
  console.log(`\n------------------------------------------------------`)
  console.log(`📊 拓扑检查数据汇总:`)
  console.log(`- 检查文档数: ${targetFiles.length}`)
  console.log(`- 校验链接数: ${totalLinksChecked}`)
  console.log(`- 物理死链数: ${deadLinksCount}`)
  console.log(`- 失效锚点数: ${deadAnchorsCount}`)
  console.log(`- 跨环穿透数: ${topologyViolations}`)
  console.log(`- 目录维护盲区 (ℹ️ 非门禁项): ${tocBlindSpotFiles.length} 份（扫描面：docs/ 全量 − docs/archive，与 docs:toc 生成面一致）`)
  console.log(`------------------------------------------------------\n`)

  if (tocBlindSpotFiles.length > 0) {
    console.log(`ℹ️ 目录维护盲区明细（标题不被生成器 TOC_HEAD_RE 识别 ⇒ pnpm run docs:toc 既不刷新也不清理）:`)
    tocBlindSpotFiles.forEach(f => {
      const detail = f.blocks.map(b => `L${b.line} ${b.title}（块内锚链接 ${b.anchors} 条）`).join('；')
      console.log(`  · ${f.file} → ${detail}`)
    })
    console.log('')
  }

  if (warnings.length > 0) {
    console.warn(`⚠️  发现 ${warnings.length} 项拓扑/锚点合规性预警:`)
    warnings.forEach((w, i) => console.warn(`  ${i + 1}. ${w}`))
    console.warn('')
  }

  if (errors.length > 0) {
    console.error(`❌ 发现 ${errors.length} 项致命错误:`)
    errors.forEach((e, i) => console.error(`  ${i + 1}. ${e}`))
    console.error(`\n======================================================`)
    process.exit(1)
  }

  console.log(`✨ 4 环拓扑健康度检查通过！零物理死链，骨架健康！`)
  console.log(`======================================================\n`)
  process.exit(0)
}

checkDocHealth()
