#!/usr/bin/env node
/**
 * scripts/sync-model-source.js
 *
 * 模型配置智能嗅探与源数据自动同步工具 (Firefly Model Source Sync)
 * 1. 支持传入单个 HuggingFace / ModelScope URL，自动嗅探主模型体积与同目录最小 mmproj、DSpark、Draft 文件大小；
 * 2. 支持分别传入不同的 --main, --mmproj, --dspark, --draft URL（跨仓库/页面卫星伴随模型）；
 * 3. 严格遵循 HTTP 零下载原则（仅通过 Tree API 与 HTTP HEAD/Range 嗅探元数据）；
 * 4. 自动生成规范 ModelItem 配置，无缝写入 apps/desktop/src/electron/config/model-source.ts 并触发 10 语种配置派生。
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '../../../../');
const MODEL_SOURCE_FILE = path.join(ROOT_DIR, 'apps/desktop/src/electron/config/model-source.ts');
const GENERATE_SCRIPT = path.join(ROOT_DIR, 'scripts/generate-extra-configs.js');

// ─────────────────────── 命令行参数解析 ───────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    mainUrl: '',
    mmprojUrl: '',
    dsparkUrl: '',
    draftUrl: '',
    source: '',
    name: '',
    company: '',
    parameterSize: '',
    intelligenceLevel: 3,
    contextLength: 131072,
    description: '',
    recommended: false,
    update: false,
    audit: false,
    fixAll: false,
    dryRun: false
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--main') options.mainUrl = args[++i];
    else if (arg === '--mmproj') options.mmprojUrl = args[++i];
    else if (arg === '--dspark') options.dsparkUrl = args[++i];
    else if (arg === '--draft') options.draftUrl = args[++i];
    else if (arg === '--source') options.source = args[++i];
    else if (arg === '--name') options.name = args[++i];
    else if (arg === '--company') options.company = args[++i];
    else if (arg === '--params') options.parameterSize = args[++i];
    else if (arg === '--level') options.intelligenceLevel = parseInt(args[++i], 10) || 3;
    else if (arg === '--ctx') options.contextLength = parseInt(args[++i], 10) || 131072;
    else if (arg === '--desc') options.description = args[++i];
    else if (arg === '--recommended') options.recommended = true;
    else if (arg === '--update' || arg === '--apply') options.update = true;
    else if (arg === '--audit' || arg === '--check') options.audit = true;
    else if (arg === '--fix-all') options.fixAll = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (!arg.startsWith('-') && !options.mainUrl) {
      options.mainUrl = arg;
    }
  }

  return options;
}

// ─────────────────────── URL 规范化解析 ───────────────────────

/**
 * 解析用户提交的模型下载地址，支持 HuggingFace 与 ModelScope
 */
function parseModelUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  const withoutTail = trimmed.split(/[?#]/)[0];
  const afterScheme = withoutTail.replace(/^https?:\/\//i, '');
  const slashIdx = afterScheme.indexOf('/');
  if (slashIdx === -1) return null;

  const host = afterScheme.substring(0, slashIdx).toLowerCase();
  const pathPart = afterScheme.substring(slashIdx + 1);
  const segments = pathPart.split('/').filter(Boolean);

  if (host.includes('modelscope.cn')) {
    // 形态: models/{org}/{repo}/file/view/{rev}/{file...} 或 models/{org}/{repo}/resolve/{rev}/{file...}
    if (segments.length >= 6 && segments[0] === 'models') {
      const org = segments[1];
      const repoName = segments[2];
      const marker = segments[3];
      let fileStart = 5;
      let rev = 'master';
      if (marker === 'file' && segments[4] === 'view') {
        rev = segments[5];
        fileStart = 6;
      } else if (marker === 'resolve') {
        rev = segments[4];
        fileStart = 5;
      }
      const filePath = segments.slice(fileStart).join('/');
      const fileName = filePath.split('/').pop() || filePath;
      return {
        source: 'modelscope',
        repo: `${org}/${repoName}`,
        rev,
        filePath,
        fileName
      };
    }
  } else if (host.includes('huggingface.co') || host.includes('hf-mirror.com')) {
    // 形态: {org}/{repo}/blob/{rev}/{file...} 或 {org}/{repo}/resolve/{rev}/{file...}
    if (segments.length >= 5) {
      const org = segments[0];
      const repoName = segments[1];
      const marker = segments[2];
      if (marker === 'blob' || marker === 'resolve' || marker === 'tree') {
        const rev = segments[3];
        const filePath = segments.slice(4).join('/');
        const fileName = filePath.split('/').pop() || filePath;
        return {
          source: 'huggingface',
          repo: `${org}/${repoName}`,
          rev,
          filePath,
          fileName
        };
      }
    }
  }

  return null;
}

// ─────────────────────── 量化标签提取 ───────────────────────

function extractQuantTag(name) {
  if (!name) return null;
  const clean = name.trim().replace(/\.gguf$/i, '');
  // 匹配标准量化标识 (如 Q4_K_M, UD-Q4_K_XL, PQ2_0, PTQ1_0, Q8_0, IQ4_XS, F16, BF16 等)
  const directMatch = clean.match(/^(?:ud-)?(q[0-9](?:_?k)?(?:_?[smlx0-9]+)?|ptq[0-9]_[0-9]+|pq[0-9]_[0-9]+|iq[0-9]_[0-9a-z_]+|bf16|fp16|f16|f32)$/i);
  if (directMatch) return directMatch[1].toUpperCase();

  const match = name.match(/[-_.](?:ud-)?(q[0-9](?:_?k)?(?:_?[smlx0-9]+)?|ptq[0-9]_[0-9]+|pq[0-9]_[0-9]+|iq[0-9]_[0-9a-z_]+|bf16|fp16|f16|f32)(?:\.gguf|$)/i);
  if (match) return match[1].toUpperCase();

  const fallbackMatch = name.match(/(q[0-9](?:_?k)?(?:_?[smlx0-9]+)?|iq[0-9]_[0-9a-z_]+|bf16|fp16|f16|f32)/i);
  return fallbackMatch ? fallbackMatch[1].toUpperCase() : null;
}

// ─────────────────────── 字节格式化 ───────────────────────

function formatBytes(bytes) {
  if (!bytes || bytes <= 0) return '0MB';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1000) {
    const gb = bytes / (1024 * 1024 * 1024);
    return `${gb.toFixed(2).replace(/\.?0+$/, '')}GB`;
  }
  return `${Math.round(mb)}MB`;
}

function parseToMB(str) {
  if (!str || typeof str !== 'string') return 0;
  const m = str.trim().toUpperCase();
  if (m.endsWith('GB')) {
    return parseFloat(m.replace('GB', '').trim()) * 1024;
  }
  if (m.endsWith('MB')) {
    return parseFloat(m.replace('MB', '').trim());
  }
  return 0;
}

// ─────────────────────── 网络探测 (Tree API & HEAD) ───────────────────────

async function fetchRemoteRepoFiles(source, repo, rev = 'main') {
  if (source === 'huggingface') {
    const url = `https://huggingface.co/api/models/${repo}/tree/${rev}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Firefly-Model-Fetcher/2.0' } });
    if (!res.ok) throw new Error(`HuggingFace API 失败 (${res.status}): ${res.statusText}`);
    const items = await res.json();
    return items.map(item => ({
      name: item.path.split('/').pop(),
      path: item.path,
      size: item.size || (item.lfs && item.lfs.size) || 0
    }));
  } else if (source === 'modelscope') {
    // 优先尝试 ModelScope repo/files API
    const effectiveRev = rev || 'master';
    const url = `https://modelscope.cn/api/v1/models/${repo}/repo/files?Revision=${effectiveRev}`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Firefly-Model-Fetcher/2.0' } });
    if (!res.ok) throw new Error(`ModelScope API 失败 (${res.status}): ${res.statusText}`);
    const json = await res.json();
    const files = json?.Data?.Files || [];
    return files.map(item => ({
      name: item.Name,
      path: item.Path || item.Name,
      size: item.Size || 0
    }));
  }
  return [];
}

async function probeSingleFileByHead(url) {
  try {
    const res = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': 'Firefly-Model-Fetcher/2.0' } });
    const cl = res.headers.get('content-length');
    if (cl && parseInt(cl, 10) > 0) {
      return parseInt(cl, 10);
    }
  } catch (e) {
    // fallback to Range
  }

  try {
    const resRange = await fetch(url, {
      method: 'GET',
      headers: { 'User-Agent': 'Firefly-Model-Fetcher/2.0', Range: 'bytes=0-0' }
    });
    const cr = resRange.headers.get('content-range');
    if (cr) {
      const totalStr = cr.split('/').pop();
      if (totalStr) {
        const val = parseInt(totalStr.trim(), 10);
        if (val > 0) return val;
      }
    }
  } catch (e) {
    // ignore
  }

  return 0;
}

// ─────────────────────── 核心嗅探器 ───────────────────────

/**
 * 嗅探指定模型 URL 及其同仓库/跨仓库伴随模型
 */
async function sniffModelInfo(options) {
  const parsedMain = parseModelUrl(options.mainUrl);
  if (!parsedMain) {
    throw new Error(`无法解析主模型 URL: "${options.mainUrl}"`);
  }

  console.log(`\n🔍 [Sniffing] 主模型: ${parsedMain.repo} / ${parsedMain.fileName} (${parsedMain.source})`);

  let mainFile = null;
  let mmprojFile = null;
  let dsparkFile = null;
  let draftFile = null;

  // 1. 获取主模型所在仓库的文件列表
  let repoFiles = [];
  try {
    repoFiles = await fetchRemoteRepoFiles(parsedMain.source, parsedMain.repo, parsedMain.rev);
  } catch (err) {
    console.warn(`   ⚠️ 无法获取仓库文件树 (${err.message})，尝试直接嗅探 HEAD...`);
  }

  // 匹配主模型文件
  if (repoFiles.length > 0) {
    mainFile = repoFiles.find(f => f.name.toLowerCase() === parsedMain.fileName.toLowerCase()) ||
               repoFiles.find(f => f.path.toLowerCase().endsWith(parsedMain.fileName.toLowerCase()));
  }

  if (!mainFile) {
    const resolveUrl = parsedMain.source === 'modelscope'
      ? `https://modelscope.cn/models/${parsedMain.repo}/resolve/${parsedMain.rev}/${parsedMain.filePath}`
      : `https://huggingface.co/${parsedMain.repo}/resolve/${parsedMain.rev}/${parsedMain.filePath}`;
    const headSize = await probeSingleFileByHead(resolveUrl);
    mainFile = {
      name: parsedMain.fileName,
      path: parsedMain.filePath,
      size: headSize
    };
  }

  // 2. 嗅探伴随模型（同目录优先）
  if (repoFiles.length > 0) {
    // 识图模型 mmproj
    const mmprojs = repoFiles.filter(f => {
      const n = f.name.toLowerCase();
      return n.endsWith('.gguf') && n.includes('mmproj');
    });
    if (mmprojs.length > 0) {
      mmprojs.sort((a, b) => a.size - b.size);
      mmprojFile = mmprojs[0];
    }

    // DSpark 加速模型
    const dsparks = repoFiles.filter(f => {
      const n = f.name.toLowerCase();
      return n.endsWith('.gguf') && (n.includes('dspark') || n.includes('spark')) && !n.includes('mmproj');
    });
    if (dsparks.length > 0) {
      dsparks.sort((a, b) => a.size - b.size);
      dsparkFile = dsparks[0];
    }

    // Draft MTP 草稿模型
    const drafts = repoFiles.filter(f => {
      const n = f.name.toLowerCase();
      return n.endsWith('.gguf') && (n.includes('draft') || n.includes('assistant')) && !n.includes('mmproj');
    });
    if (drafts.length > 0) {
      drafts.sort((a, b) => a.size - b.size);
      draftFile = drafts[0];
    }
  }

  // 3. 独立显式 URL 覆盖（跨仓库或指定卫星伴随模型）
  if (options.mmprojUrl) {
    const parsedMm = parseModelUrl(options.mmprojUrl);
    if (parsedMm) {
      const mmUrl = parsedMm.source === 'modelscope'
        ? `https://modelscope.cn/models/${parsedMm.repo}/resolve/${parsedMm.rev}/${parsedMm.filePath}`
        : `https://huggingface.co/${parsedMm.repo}/resolve/${parsedMm.rev}/${parsedMm.filePath}`;
      const size = await probeSingleFileByHead(mmUrl);
      mmprojFile = {
        name: parsedMm.fileName,
        path: parsedMm.filePath,
        repo: parsedMm.repo,
        size
      };
      console.log(`   🔗 独立挂载 mmproj: ${parsedMm.repo}/${parsedMm.fileName} (${formatBytes(size)})`);
    }
  }

  if (options.dsparkUrl) {
    const parsedDs = parseModelUrl(options.dsparkUrl);
    if (parsedDs) {
      const dsUrl = parsedDs.source === 'modelscope'
        ? `https://modelscope.cn/models/${parsedDs.repo}/resolve/${parsedDs.rev}/${parsedDs.filePath}`
        : `https://huggingface.co/${parsedDs.repo}/resolve/${parsedDs.rev}/${parsedDs.filePath}`;
      const size = await probeSingleFileByHead(dsUrl);
      dsparkFile = {
        name: parsedDs.fileName,
        path: parsedDs.filePath,
        repo: parsedDs.repo,
        size
      };
      console.log(`   🔗 独立挂载 dspark: ${parsedDs.repo}/${parsedDs.fileName} (${formatBytes(size)})`);
    }
  }

  if (options.draftUrl) {
    const parsedDr = parseModelUrl(options.draftUrl);
    if (parsedDr) {
      const drUrl = parsedDr.source === 'modelscope'
        ? `https://modelscope.cn/models/${parsedDr.repo}/resolve/${parsedDr.rev}/${parsedDr.filePath}`
        : `https://huggingface.co/${parsedDr.repo}/resolve/${parsedDr.rev}/${parsedDr.filePath}`;
      const size = await probeSingleFileByHead(drUrl);
      draftFile = {
        name: parsedDr.fileName,
        path: parsedDr.filePath,
        repo: parsedDr.repo,
        size
      };
      console.log(`   🔗 独立挂载 draftId: ${parsedDr.repo}/${parsedDr.fileName} (${formatBytes(size)})`);
    }
  }

  // 4. 组装规范 ModelItem 元数据
  const quantTag = extractQuantTag(parsedMain.fileName) || 'Q4_K_M';
  const modelId = `${parsedMain.repo}:${quantTag}`;

  const mainBytes = mainFile ? mainFile.size : 0;
  const mmprojBytes = mmprojFile ? mmprojFile.size : 0;
  const dsparkBytes = dsparkFile ? dsparkFile.size : 0;
  const draftBytes = draftFile ? draftFile.size : 0;

  const modelSizeStr = formatBytes(mainBytes);
  const mmprojSizeStr = mmprojBytes > 0 ? formatBytes(mmprojBytes) : undefined;
  const dsparkSizeStr = dsparkBytes > 0 ? formatBytes(dsparkBytes) : undefined;
  const draftSizeStr = draftBytes > 0 ? formatBytes(draftBytes) : undefined;

  // 基础包总体积 (主模型 + 识图投影)
  const totalBytes = mainBytes + mmprojBytes;
  const totalSizeStr = formatBytes(totalBytes);

  // 伴随模型短标签推导
  let mmprojTag = undefined;
  if (mmprojFile) {
    if (mmprojFile.repo && mmprojFile.repo !== parsedMain.repo) {
      mmprojTag = mmprojFile.repo;
    } else {
      mmprojTag = extractQuantTag(mmprojFile.name) || mmprojFile.name.replace(/\.gguf$/i, '');
    }
  }

  let dsparkTag = undefined;
  if (dsparkFile) {
    if (dsparkFile.repo && dsparkFile.repo !== parsedMain.repo) {
      dsparkTag = dsparkFile.repo;
    } else {
      const dsMatch = dsparkFile.name.match(/(dspark-[a-z0-9_]+)/i);
      dsparkTag = dsMatch ? dsMatch[1] : dsparkFile.name.replace(/\.gguf$/i, '');
    }
  }

  let draftId = undefined;
  if (draftFile) {
    draftId = draftFile.repo ? draftFile.repo : `${parsedMain.repo}:${draftFile.name.replace(/\.gguf$/i, '')}`;
  }

  // 展示名称推导
  const repoNameClean = parsedMain.repo.split('/').pop().replace(/-gguf$/i, '');
  const displayName = options.name || repoNameClean;
  const company = options.company || parsedMain.repo.split('/')[0];

  const result = {
    id: modelId,
    name: displayName,
    company,
    parameterSize: options.parameterSize || '2B',
    intelligenceLevel: options.intelligenceLevel || (mmprojFile ? 3 : 2),
    modelSize: modelSizeStr,
    mmproj: mmprojTag,
    mmprojSize: mmprojSizeStr,
    dspark: dsparkTag,
    dsparkSize: dsparkSizeStr,
    draftId: draftId,
    draftSize: draftSizeStr,
    totalSize: totalSizeStr,
    recommended: options.recommended,
    description: options.description || `${displayName} 开源模型。`,
    source: parsedMain.source,
    quantization: quantTag,
    isMultiModal: Boolean(mmprojFile),
    contextLength: options.contextLength,
    capabilities: mmprojFile ? ['TEXT', 'IMAGE'] : ['TEXT'],
    performance: {
      speed: 'fast',
      quality: 'high'
    },
    tags: mmprojFile ? ['多模态', '识图'] : ['仅文本'],
    recommendedConfig: {
      numCtx: 8192,
      numPredict: 2048
    }
  };

  console.log('\n📊 [Result] 探测完成:');
  console.log(`   - Model ID:   ${result.id}`);
  console.log(`   - Model Size: ${result.modelSize}`);
  if (result.mmproj) console.log(`   - MMProj:     ${result.mmproj} (${result.mmprojSize})`);
  if (result.dspark) console.log(`   - DSpark:     ${result.dspark} (${result.dsparkSize})`);
  if (result.draftId) console.log(`   - Draft:      ${result.draftId} (${result.draftSize})`);
  console.log(`   - Total Size: ${result.totalSize}`);
  console.log(`   - MultiModal: ${result.isMultiModal}`);

  return result;
}

// ─────────────────────── model-source.ts 文件更新 ───────────────────────

/**
 * 将嗅探结果就地更新或追加至 apps/desktop/src/electron/config/model-source.ts
 */
function updateModelSourceFile(modelItem, dryRun = false) {
  if (!fs.existsSync(MODEL_SOURCE_FILE)) {
    throw new Error(`找不到配置文件: ${MODEL_SOURCE_FILE}`);
  }

  let code = fs.readFileSync(MODEL_SOURCE_FILE, 'utf8');

  // 判断是否已存在相同 id 和 source 的条目
  const idRegex = new RegExp(`id:\\s*['"]${modelItem.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`);
  const hasEntry = idRegex.test(code);

  if (hasEntry) {
    console.log(`\n🔄 [Update] 模型 [${modelItem.id}] 已存在于配置中，执行就地精准字段补全/对齐...`);

    // 定位目标条目块
    const lines = code.split(/\r?\n/);
    let targetStart = -1;
    let targetEnd = -1;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].includes(`id: '${modelItem.id}'`) || lines[i].includes(`id: "${modelItem.id}"`)) {
        // 向前回溯找到对象起始 '{'
        for (let j = i; j >= 0; j--) {
          if (lines[j].trim() === '{') {
            targetStart = j;
            break;
          }
        }
        // 向后查找找到对象闭合 '}'
        for (let j = i; j < lines.length; j++) {
          if (lines[j].trim() === '},' || lines[j].trim() === '}') {
            targetEnd = j;
            break;
          }
        }
        break;
      }
    }

    if (targetStart >= 0 && targetEnd > targetStart) {
      let block = lines.slice(targetStart, targetEnd + 1).join('\n');

      // 更新字段
      function upsertField(blockStr, key, val) {
        if (val === undefined || val === null) return blockStr;
        const keyPattern = new RegExp(`^(\\s*)${key}:\\s*[^,\\n]+(,?)$`, 'm');
        const formattedVal = typeof val === 'string' ? `'${val}'` : val;
        if (keyPattern.test(blockStr)) {
          return blockStr.replace(keyPattern, `$1${key}: ${formattedVal}$2`);
        } else {
          // 在 id 行之后插入
          return blockStr.replace(/(id:\s*['"][^'"]+['"],?)/, `$1\n      ${key}: ${formattedVal},`);
        }
      }

      block = upsertField(block, 'modelSize', modelItem.modelSize);
      if (modelItem.mmproj) block = upsertField(block, 'mmproj', modelItem.mmproj);
      if (modelItem.mmprojSize) block = upsertField(block, 'mmprojSize', modelItem.mmprojSize);
      if (modelItem.dspark) block = upsertField(block, 'dspark', modelItem.dspark);
      if (modelItem.dsparkSize) block = upsertField(block, 'dsparkSize', modelItem.dsparkSize);
      if (modelItem.draftId) block = upsertField(block, 'draftId', modelItem.draftId);
      if (modelItem.draftSize) block = upsertField(block, 'draftSize', modelItem.draftSize);
      block = upsertField(block, 'totalSize', modelItem.totalSize);
      block = upsertField(block, 'isMultiModal', modelItem.isMultiModal);

      const before = lines.slice(0, targetStart).join('\n');
      const after = lines.slice(targetEnd + 1).join('\n');
      code = `${before}\n${block}\n${after}`;
    }
  } else {
    console.log(`\n➕ [Append] 模型 [${modelItem.id}] 为新条目，追加至配置列表首位...`);
    // 在 models: [ 后面插入新条目
    const insertPattern = /(models:\s*\[)/;
    const newEntryCode = `
    {
      id: '${modelItem.id}',
      name: \`${modelItem.name}\`,
      company: '${modelItem.company}',
      parameterSize: '${modelItem.parameterSize}',
      intelligenceLevel: ${modelItem.intelligenceLevel},
      modelSize: '${modelItem.modelSize}',${modelItem.mmproj ? `\n      mmproj: '${modelItem.mmproj}',` : ''}${modelItem.mmprojSize ? `\n      mmprojSize: '${modelItem.mmprojSize}',` : ''}${modelItem.dspark ? `\n      dspark: '${modelItem.dspark}',` : ''}${modelItem.dsparkSize ? `\n      dsparkSize: '${modelItem.dsparkSize}',` : ''}${modelItem.draftId ? `\n      draftId: '${modelItem.draftId}',` : ''}${modelItem.draftSize ? `\n      draftSize: '${modelItem.draftSize}',` : ''}
      totalSize: '${modelItem.totalSize}',
      recommended: ${modelItem.recommended},
      description: t('${modelItem.description}'),
      source: '${modelItem.source}',
      quantization: '${modelItem.quantization}',
      isMultiModal: ${modelItem.isMultiModal},
      contextLength: ${modelItem.contextLength},
      capabilities: ${JSON.stringify(modelItem.capabilities)},
      performance: {
        speed: 'fast',
        quality: 'high'
      },
      tags: [${modelItem.tags.map(tag => `t('${tag}')`).join(', ')}],
      recommendedConfig: {
        numCtx: 8192,
        numPredict: 2048
      }
    },`;

    code = code.replace(insertPattern, `$1${newEntryCode}`);
  }

  if (dryRun) {
    console.log('\n[Dry Run] 变更未写入磁盘。');
    return;
  }

  // 保持换行符一致写回
  fs.writeFileSync(MODEL_SOURCE_FILE, code, 'utf8');
  console.log(`✅ [Success] 已更新 ${MODEL_SOURCE_FILE}`);

  // 自动触发全语言生成与校验门禁
  console.log('\n🚀 [Generate] 正在运行 scripts/generate-extra-configs.js 生成 10 语种配置与门禁校验...');
  try {
    execSync(`node ${GENERATE_SCRIPT}`, { stdio: 'inherit', cwd: ROOT_DIR });
    console.log('✨ [Success] 全语言 JSON 生成并通过公差校验！');
  } catch (err) {
    console.error('❌ [Error] 配置文件派生失败:', err.message);
    process.exit(1);
  }
}

// ─────────────────────── 全库审计与修复模式 ───────────────────────

async function auditAndFixAll(fixAll = false) {
  console.log(`\n📋 [Audit] 正在审计 ${MODEL_SOURCE_FILE} 中的所有模型条目...`);
  const content = fs.readFileSync(MODEL_SOURCE_FILE, 'utf8');
  const fnCode = content.substring(content.indexOf('export const MODEL_CONFIG_SOURCE'));
  const mockT = s => s;
  const sandbox = new Function('t', `
    const MODEL_CONFIG_SOURCE = ${fnCode.replace('export const MODEL_CONFIG_SOURCE = ', '')};
    return MODEL_CONFIG_SOURCE();
  `);
  const data = sandbox(mockT);

  const issues = [];
  for (const m of data.models) {
    const isMm = m.isMultiModal === true;
    const hasMmproj = Boolean(m.mmproj || m.mmprojSize);
    const hasDspark = Boolean(m.dspark || m.dsparkSize);
    const hasDraft = Boolean(m.draftId || m.draftSize);

    const missing = [];
    if (isMm || hasMmproj || hasDspark || hasDraft) {
      if (!m.modelSize) missing.push('modelSize');
      if (isMm && !m.mmprojSize) missing.push('mmprojSize');
      if (hasDspark && !m.dsparkSize) missing.push('dsparkSize');
      if (hasDraft && !m.draftSize) missing.push('draftSize');
    }

    if (missing.length > 0) {
      issues.push({ model: m, missing });
    }
  }

  if (issues.length === 0) {
    console.log('🎉 [Audit Pass] 所有伴随模型与多模态模型均已完整配置分项体积，无缺失项！');
    return;
  }

  console.log(`⚠️ 发现 ${issues.length} 个模型缺少分项体积字段：`);
  issues.forEach((iss, idx) => {
    console.log(`   ${idx + 1}. [${iss.model.source}] ${iss.model.id} -> 缺失: ${iss.missing.join(', ')}`);
  });

  if (!fixAll) {
    console.log('\n💡 提示：运行 `pnpm model-sync --fix-all` 可自动联网嗅探并补全上述缺失字段！');
    return;
  }

  console.log('\n🛠️ [Fix All] 正在自动联网嗅探并修复全部缺失条目...');
  for (const iss of issues) {
    const m = iss.model;
    const [repo, quant] = m.id.split(':');
    let url = '';
    if (m.source === 'huggingface') {
      url = `https://huggingface.co/${repo}/blob/main/${quant || 'model'}.gguf`;
    } else {
      url = `https://modelscope.cn/models/${repo}/file/view/master/${quant || 'model'}.gguf`;
    }

    try {
      const sniffed = await sniffModelInfo({ mainUrl: url });
      // 保持原有展示名与关键配置
      sniffed.name = m.name;
      sniffed.description = m.description;
      sniffed.company = m.company;
      sniffed.parameterSize = m.parameterSize;
      sniffed.intelligenceLevel = m.intelligenceLevel;
      sniffed.recommended = m.recommended;
      sniffed.tags = m.tags;
      sniffed.contextLength = m.contextLength;

      updateModelSourceFile(sniffed, false);
    } catch (e) {
      console.warn(`   ❌ 无法自动嗅探 [${m.id}]: ${e.message}`);
    }
  }
}

// ─────────────────────── 入口函数 ───────────────────────

async function main() {
  const options = parseArgs();

  if (options.audit || options.fixAll) {
    await auditAndFixAll(options.fixAll);
    return;
  }

  if (!options.mainUrl) {
    console.log(`
使用指南:
  pnpm model-sync <URL> [选项]
  node scripts/sync-model-source.js <URL> [选项]

基础用法:
  # 嗅探单个 HuggingFace 模型并打印信息（不写入）
  node scripts/sync-model-source.js https://huggingface.co/saidutta69/LFM3-VL-2B-heretic/blob/main/LFM3-VL-2B-heretic-Q4_K_M.gguf

  # 嗅探并直接更新写入 model-source.ts，同时自动生成 10 语种配置
  node scripts/sync-model-source.js https://huggingface.co/saidutta69/LFM3-VL-2B-heretic/blob/main/LFM3-VL-2B-heretic-Q4_K_M.gguf --update

高级用法 (跨仓库卫星伴随模型):
  node scripts/sync-model-source.js \\
    --main https://huggingface.co/unsloth/gemma-4-E2B-it-qat-MTP-GGUF/blob/main/gemma-4-E2B-it-qat-UD-Q4_K_XL.gguf \\
    --draft https://huggingface.co/NicklausCairns/gemma-4-E2B-it-qat-assistant-MTP-Q8_0/blob/main/assistant.gguf \\
    --update

审计模式:
  node scripts/sync-model-source.js --audit
  node scripts/sync-model-source.js --fix-all
`);
    process.exit(0);
  }

  const sniffed = await sniffModelInfo(options);
  if (options.update) {
    updateModelSourceFile(sniffed, options.dryRun);
  } else {
    console.log('\n💡 提示：附加 `--update` 参数可将此模型配置直接写入 model-source.ts！');
  }
}

main().catch(err => {
  console.error('\n❌ 执行异常:', err);
  process.exit(1);
});
