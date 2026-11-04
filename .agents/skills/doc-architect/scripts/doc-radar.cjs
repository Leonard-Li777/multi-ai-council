#!/usr/bin/env node
/**
 * .agents/skills/doc-architect/scripts/doc-radar.js
 *
 * 确定性知识路由与业务心智预加载雷达 (Deterministic Context Radar)
 *
 * 用法：
 *   node .agents/skills/doc-architect/scripts/doc-radar.js [文件路径或任务关键词...]
 *   node .agents/skills/doc-architect/scripts/doc-radar.js --git (自动扫描当前工作区改动文件)
 *   node .agents/skills/doc-architect/scripts/doc-radar.js --json [参数...]
 */

const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')

const ROOT_DIR = path.resolve(__dirname, '../../../../')

// 确定性路由规则矩阵：将【文件路径特征 / 代码符号 / 业务关键词】映射至【L2 必读枢纽 + 业务核心铁律摘要】
const RADAR_RULES = [
  {
    id: 'controlled-concepts',
    title: '受控概念与语义判定规范 (PRD-0058)',
    docPath: 'docs/developer/standards/controlled-concepts-guide.md',
    // 抽词/融合链路（tokenizer / fusion / anchor_cache）必须一并命中本规则：
    // 文本源标签被系统性丢弃的根因就在 tokenizer 的词性门，只按 /tag/ 匹配会整段漏读。
    pathPatterns: [/concept/i, /tag/i, /dimension/i, /semantic/i, /ontology/i, /omw/i, /hownet/i, /admissib/i, /nsfw/i, /tokenizer/i, /fusion/i, /anchor[_-]?cache/i, /file[-_]policy/i, /file[-_]constants/i, /file-extension-policies/i],
    keywords: ['标签', '概念', '维度', '受控', 'omw', 'hownet', 'builtin', '多语言别名', '未归类', 'SENTINEL', '打标', '分类', '抽词', '分词', '词性门', 'jieba', '先验', '锚点', '文本源', 'OCR', 'ASR', 'LRC', 'exclude_names', '跳级', 'pathCountMap', '穿透提升', 'branchCodePath', '文件策略', '三维策略', '父目录补偿', 'SkipContent', 'Immutable', 'FactCard', 'file-extension-policies'],
    invariants: [
      '三阶段铁律：Ingress 归一化为 code ➔ Processing 100% 仅认强类型枚举/code ➔ Egress 反查展示名',
      '权威优先级：omw.* > hownet.* > builtin.*，凡 OMW/HowNet 已有概念严禁私造 builtin.*',
      '文件策略单一事实源与反魔法 Code：file-extension-policies.json 严禁裸写受控代码字符串（如 builtin.source_code 属违规伪码）；受控代码 100% 依循两端原生强类型系统（TS concept(\'中文\') / Rust Concept::）',
      '文件感知三维策略门控：代码与系统配置 100% 走 Immutable（禁改名）+ SkipContent（跳过正文抽词防走音）+ FactCard（事实卡片跳过散文）；短名文件依靠父目录语义补偿（过滤 20+ 停用目录），严禁针对单一格式私写特判解析器',
      '领域排他门控：非视觉介质（音频/文档/代码/压缩包）严禁挂载视觉维度（画质/水印/打码/主色调等）',
      '严禁在等值/集合判定中使用自然语言词串或 t()，哨兵值统一用 SENTINEL_NAMES',
      '严禁使用展示名做聚合统计：汇聚文件与计算徽标 100% 遵从受控 code，严禁按中文名聚合（防同形异义词串扰引发树徽标与列表口径分裂）',
      'jieba 词性门 `eng` 判定必须前置短路于 `starts_with(\'e\')`（叹词 e*）：否则 jieba 标注为 eng 的纯 ASCII 英文实体词在**抽词阶段**被整词误杀，根本进不了候选池（tag_admissibility.rs::is_jieba_tag_non_entity）',
      '文本源 ASCII 准入闸的**语言受众 = CJK 分词路径（zh + ja，uses_cjk_tokenization）**，必须与 `eng` 词性门受众同源；纯文件名来源候选在适用域之外，行为严禁改变（fusion.rs::apply_text_source_ascii_gate）',
      '未受控 OCR/ASR 先验取单一事实源 OBJECTIVE_TEXT_PRIOR_CONFIDENCE = 0.90，严禁任何 0.65 特判复活',
      '锚点余弦只对同一编码器有效（encoder_id + dim 必须校验）；缓存未命中/过期/编码器不匹配一律降级为纯受控打标，严禁把 sim_global == 0 当作编码失败的判据',
      '多语言篇章容量与 CJK 字符学铁律：严禁使用 !ch.is_ascii() 代理 CJK（西里尔与阿拉伯语全非 ASCII 会被误伤）；CJK 须按 Unicode 汉字/假名/谚文精准匹配；篇章扩容支持 CJK >= 20 或西文/西里尔 >= 60 字符；长专名（>=8）与复合实体（含空格 >=7）享受 0.30 门限，短单字（<=6）严守 0.35 门限',
      '介质排他与容量解耦铁律：视觉专有维度排他门禁仅在确属纯文档（resolved_source_kind == "document"）时触发，严禁对图片/视频的多模态描述（multimodal_desc）连坐误杀视觉标签',
      '视频多源打标出处保真铁律：Stage 2 中 ASR（source: "asr"）与代表帧 OCR（source: "ocr"）双路独立打标，严禁互斥截断或合并单串；合并去重后按置信度降序排序并截断至对应容量上限（纯文档 20，多媒体 8）'
    ]
  },
  {
    id: 'v4-architecture-db',
    title: '端云全景架构与创世数据库规范',
    docPath: 'docs/developer/architecture/v4-end-to-end-architecture.md',
    pathPatterns: [/database/i, /schema/i, /sqlite/i, /migration/i, /search/i, /retrieve/i, /sync/i, /supabase/i, /omni/i, /ai-engine/i, /param_builder/i, /tier/i, /pricing/i, /payment/i, /firecore/i, /recharge/i, /model-source/i, /model-sync/i],
    keywords: ['数据库', '建表', 'schema', 'sql', '检索', '召回', '同步', 'supabase', '向量', 'semantic.pack', '主库', '启动', '预热', 'fastfs', '档位', '嵌入', 'embedding', 'bekko', 'gemma', 'MRL', '编码器', '显存', 'vram', '草稿', 'mmproj', 'dspark', 'param_builder', '定价', '配置同步', 'CONSUME_PRICING', '权益', 'entitlements', '假空态', '流式搜索', 'clipPending', 'GlobalSearchOverlay', '多阶段搜索', '两阶段搜索', '两段搜索', 'Phase 1', 'ensureFullChildrenMap', 'DirectoryHeader', 'FileList', 'loading', '通栏进度条', 'indeterminate-bar', '会员', '定价', '阶梯', '萤火', '充值', '退款', 'tier', 'pricing', 'recharge', 'firecores', 'lifetime', '400萤火', 'model-source', '伴随模型', '投机采样', 'draftId', 'model-sync'],
    invariants: [
      '应用未上线：直接修改创世基线 GENESIS_V1_SCHEMA，严禁编写 ALTER TABLE 迁移脚本',
      '单一主库：本地唯一主库 firefly-ai-folder.db；语义库由 Omni 独占挂载 semantic.pack，严禁业务层寻址 semantic.raw.db',
      '模型源配置与伴随模型单一事实源：model-source.ts 中主模型与伴随模型（mmproj 投影、dspark 加速、draftId 草稿）必须显式拆分配置实际体积；各分项之和与 totalSize 偏差严禁超过 5% 公差红线；伴随模型跨仓库时 ModelResolver 与 Rust 后端必须通过家族前缀与声明元数据跨目录回溯，严禁仅因跨仓库而误判未落盘',
      '禁止静默降级：检索候选源或子查询 catch 块必须 logger.warn 上报原因，严禁静默吞异常返回空集',
      '冷启动非阻塞：未就绪态 searchFastFs 须 0ms 快速降级至 FTS5 本地检索并后台静默预热，不累计熔断器错误，严禁穿透阻塞死锁',
      'Supabase 同步：写前必须调用 sanitizeObject 清理 \\u0000 字符，父表失败需级联过滤子表记录防 23503',
      '配置源头治理与防伪兜底：严禁在消费侧或 RPC 中编写二/三级硬编码伪兜底（如私自 CASE 映射）；未配置直接显式抛错，暴露源头同步缺陷',
      '云端为唯一合法标准 (SSOT)：在线状态下资产与权益（entitlements、computed_limits）必须由云端原子 RPC 成功作为唯一准绳，严禁客户端擅自乐观增发权益再反向迎合',
      '档位感知编码通道：query / 段落对齐 / 文件分析抽词三条通道必须由同一次档位解析结果驱动；「要一个向量」走 batch-embed-text 或 match-passages(profile,dim)，严禁走 /api/text/analyze（全量特征端点，历史上内部无条件构造 BekkoEmbedder）',
      '编码器与 encoderFilter 白名单必须同源（classic→[0,1]、gemma→[4]），禁各算一次；否则「按 gemma 编码、按 classic 过滤」⇒ 向量路恒定空召回（不报错、静默降级）',
      '多阶段流式检索防假空态：派生加载态 effectiveLoading = !isSettled || isLoading 根除首帧 Render Lag；Phase 1 零命中保持 Loading；呼吸条超时严禁关闭全局 Loading；Phase 2 若 clipPending 必须保持未结算 Loading 直至 Phase 3 推流上屏或视觉兜底结束；虚拟列表测量帧（height<=0 且条目>0）严禁渲染 EmptyState',
      'Phase 1 前置零阻塞与非空保护：全域关键词搜索严禁在 Phase 1 前同步请求 Omni 分类树装配（ensureFullChildrenMap 必须加 selectedTags.length > 0 门禁），首屏预算严格 <= 50ms；前端非空列表（searchListItems > 0）在未 settle 期间严禁降级回退为居中 Loading 占位框',
      '前端非空列表防遮挡与通栏流光：非空列表（items > 0）在 loading 期间严禁使用全屏或 backdrop-blur 遮罩遮挡，改由 DirectoryHeader 底边与搜索浮层顶边通栏流动进度条（animate-indeterminate-bar）提示；列表仅在空数据（items == 0）且 loading 时展示居中美化 Loading 占位，且必须保留根级 ref={containerRef} 以防 ResizeObserver 尺寸测量脱落导致宽高塌陷，所有 Hooks 必须在任何提前 return 之前执行',
      '投机采样与结构化推理治理：凡激活 DSpark / 草稿投机采样加速，采样惩罚项必须强制归零（penalty=0），温度封顶 0.2，防止主草模型 logits 惩罚状态发散导致接受率暴跌（至 4%）与 JSON 引号逃逸',
      '会员与阶梯门槛铁律：邀请解锁私有目录无限分析额度统一为 400 萤火门槛（4阶段自洽 Stepper）；定价遵循买3季送1季（年付168/终身398），云端 RPC 严格动态读取 app_config.TIER_CONSTANTS，退款冲正支持 lifetime 识别且 Creem Webhook 必须使用真实订单号（ord_xxx）作为统一交易单号保持强幂等'
    ]
  },
  {
    id: 'taxonomy-build-chain',
    title: '词形表构建链：权威源回写、推导闸与质量门禁',
    docPath: 'docs/developer/architecture/v4-end-to-end-architecture.md',
    pathPatterns: [/taxonomy[\\/]/i, /build-taxonomy/i, /lexical_entries/i, /materialize_checkpoint/i, /step5_split_lang/i, /step2_translate/i, /retranslate/i, /check-step2-quality/i, /sync-merged-table/i, /promote-durable/i],
    keywords: ['词形表', '翻译质量', '多义塌缩', 'PCR', '推导闸', 'derive_from', '物化', 'step5', 'step6', 'MT 通道', 'magpie', '探活', 'synset 覆盖', 'gapfill', '不动点', '权威源'],
    invariants: [
      '权威源单向回写：omw_lexical_entries.csv 是 10 个 locale 分表的唯一权威源，step5 逐个 locale 覆写分表（0 行也写）；只改分表不同步总表 ⇒ 下次构建静默抹掉（§6.2.1）',
      '收敛判据是 step5 → step6 往返后分表 md5 字节级不变，不是「行数对得上」；首轮允许行序归一化，第二轮起必须一致',
      '新推导行必须有 synset 维度：生产链固定 --derive-from-lang ko=unambiguous,de=unambiguous,ru=unambiguous，严禁退回 auto（扁平 checkpoint 无 synset 维度，de 每轮 +7,869 条残渣、PCR 8.0%→23.0%）',
      '严禁为「补行数」放宽推导闸——行数与质量负相关（de 54,478 行 PCR 23.0% vs 48,761 行 PCR 8.0%）',
      '质量门禁四态：0 PASS / 1 FAIL / 3 SKIP / N/A 不适用（exit 0）；语种类型按 A/B 族占比 ≥95% 复算，导入型改判 pcr_gapfill + synset 覆盖率，三态时代「0/0 报成 0.0% 通过」已废止',
      'MT 通道两级探活：/models 失败回落一次 max_tokens=1 的 chat 探活；/models 502 但 chat 200 必须判可用；全挂 exit 4 且不写任何 CSV，仅 --allow-degraded 降级'
    ]
  },
  {
    id: 'path-normalization',
    title: '跨平台路径同源处理纪律',
    docPath: 'docs/developer/standards/path-normalization-guideline.md',
    pathPatterns: [/path/i, /watcher/i, /scanner/i, /file-system/i, /fs/i],
    keywords: ['路径', 'path', '分隔符', 'isSubPath', 'isPathEqual', '斜杠', 'windows路径'],
    invariants: [
      '比较层零转换：文件路径保持原生 path.sep，比较层（isPathEqual/isSubPath/SQL WHERE path）严禁做分隔符替换',
      '强制使用 shared/src/utils/path.ts 中的 5 大原生函数白名单'
    ]
  },
  {
    id: 'virtual-directory',
    title: '虚拟目录架构与智能整理服务',
    docPath: 'docs/features/file-management/virtual-directory-guide.md',
    pathPatterns: [/virtual-dir/i, /organize/i, /folder-tree/i, /smart-name/i, /PlanGenerator/i, /batch-organize/i],
    keywords: ['虚拟目录', '平铺', '文件树', '智能文件名', '整理', '批量整理', '一键整理', '找补', '断路器', 'OOM', '容量上限'],
    invariants: [
      '预览文件树必须使用生成的智能文件名而非物理真实文件名',
      '勾选平铺文件到虚拟目录时，预览树必须变为无目录层级的平铺结构',
      '整理容量门禁位置与双向分流铁律：单次推荐上限 3,000 文件（LLM 500），首页与卫星工具（更名/标签/查重）全量供给无阻断；门禁精确下沉至批量整理入口（mode-select），支持切片/筛选/知险硬穿三向分流；工作台超限横幅支持切片与全量双向互斥切换；IPC 断路器支持 force 审计放行；返回首页自动复位',
      'SQLite 原生治理：大批量 ID 过滤严禁拼接 IN (?, ?, ...) 巨型字符串，统一使用 IN (SELECT value FROM json_each(?)) 单参数绑定',
      '靶向找补防雪崩：Done 阶段未归类找补严格截断 Top 200，严禁将全量孤立文件直接塞入 LLM',
      '智能聚类微调确定性调和铁律：用户手动增删改与拖拽锁定（pinnedFiles）在滑块重算时通过 6 阶段流水线确定性保留并全自动静默融合；删除自定义目录不入黑名单并级联清理锁定记录；getFileUniqueId 严格包含物理路径防同名文件蒸发；新增目录挂载空骨架（files: []）；新建目录排除未归类哨兵计算业务数并自适应扩容（硬上限 100 目录与 10 层深度）'
    ]
  },
  {
    id: 'testing-guide',
    title: '全栈测试与隔离编译规范',
    docPath: 'docs/developer/standards/testing-guide.md',
    pathPatterns: [/\.test\./i, /\.spec\./i, /__tests__/i, /vitest/i, /Cargo\.toml/i, /cargo-runner/i],
    keywords: ['test', 'cargo', 'vitest', '单测', '测试', 'spec', 'cargo-runner'],
    invariants: [
      'Desktop 测验必须使用指定 Electron ABI 运行器脚本（严禁直接裸跑 Node/Vitest 防 better-sqlite3 ABI 崩溃）',
      'Omni Rust 绝对严禁裸跑 cargo test/check（多 worktree 共享锁与 ABI 污染），唯一合法运行网关：node scripts/cargo-runner.js --task=<固定热池名> test/check -p <crate> --lib <用例名>',
      '热缓存池枚举：--task 仅允许复用固定热缓存池（如 test-dev, check-dev, default, unit, bench-dev, ci），严禁随机捏造任务名（打空热缓存池开辟全新目录，触发 5 分钟+ 全量慢重编）'
    ]
  },
  {
    id: 'public-services',
    title: '公共运行时单例服务字典',
    docPath: 'docs/developer/references/public-services-catalog.md',
    pathPatterns: [/runtime-services/i, /service\.ts$/i, /ipc/i],
    keywords: ['服务', 'service', '单例', 'ipc', 'runtime'],
    invariants: [
      '新增或修改核心 Runtime Service 方法签名时，必须优先复用既有单例并同步更新服务字典'
    ]
  },
  {
    id: 'engine-bridge-availability',
    title: 'Tier 2 引擎桥接：进程存活与服务可用两态分离',
    docPath: 'docs/specs/engine-host-restart-service-recovery-and-503-semantics-spec.md',
    pathPatterns: [
      /engine-bridge/i,
      /service-start-policy/i,
      /process_guard\.rs/i,
      /server[\\/]proxy\.rs/i
    ],
    keywords: [
      'engine-bridge',
      'EngineBridge',
      'ensureRunning',
      'startService',
      '推理服务',
      'target_port',
      'engine_starting',
      'engine_service_stopped',
      'engine_failed',
      '503'
    ],
    invariants: [
      '探活可响应 ≠ 推理服务可用：/api/engine/status 返回 200 只证明宿主进程活着，status 仍可能是 stopped（target_port 为 None），此时 /v1/* 恒 503；判定必须按 starting/ready/processing/error/stopped 分层，stopped 也要主动拉起',
      '三处收口缺一不可：ensureRunning 命中分支、start() 复用在世宿主、doStart 的探活命中与 spawn 之后（核心）；只改 ensureRunning 无法修复事故，因为事故走的是 doStart 全路径',
      'ProcessStatus::Failed 必须映射 HTTP 500，严禁混入 503——客户端 isTransientInfraError 按 status===503 无条件判瞬态，会让文件无限 pending 重试、故障永不上浮',
      '可用性判定必须留在 service-start-policy.ts 纯模块：服务文件顶层 import electron，vitest 不可加载，判定搬回服务文件即失去真值表覆盖'
    ]
  },
  {
    id: 'git-concurrency',
    title: '多会话并发 Git 与 Worktree 规范',
    docPath: 'docs/developer/standards/git-concurrency-workflow.md',
    pathPatterns: [/worktree/i, /commit/i, /\.git/i],
    keywords: ['git', 'commit', 'worktree', '提交', '分支'],
    invariants: [
      '一会话一独立 worktree；严禁 git add . / -A 通配提交，必须显式指定 pathspec 或用 GIT_INDEX_FILE'
    ]
  },
  {
    id: 'preset-resources',
    title: '预设资源分发管线规范 (index/lockfile/BOM/release 四件套)',
    docPath: 'docs/developer/architecture/preset-resources-distribution-pipeline.md',
    pathPatterns: [/preset-?resources/i, /firefly-resources/i, /publish-resources/i, /consume-preset/i, /resources\.bom/i, /download-.*-resources/i],
    keywords: ['预设资源', 'presetResources', 'index.json', 'lockfile', 'BOM', 'release 资产', 'sha256', '发布资源', '容器仓库', '找不到资产'],
    invariants: [
      '钉定≠发布：lockfile 钉定只是声明意图，release 缺资产时消费端必挂，发布是独立显式步骤',
      'zip 重建 ⇒ sha256 漂移（时间戳元数据）而体积不变：发布后必须回填 index.json 并同步 desktop BOM',
      '资产名大小写敏感：assetNameFor 不做小写规范化，索引声明小写名时用 gh release upload 直传保名',
      'dev 模式免 sha 校验会掩盖 release 缺失：验证必须空 preset 缓存 + NODE_ENV=production 实下载',
      '装配版本匹配大小写防呆：setup-extra-resources 中的版本查找必须 toLowerCase() 匹配，防止 INT8-v3 vs int8-v3 大小写不一致回退到旧包',
      'BOM 继承机制：buildBom 必须继承旧 BOM 中同版本的 files[] 逐件哈希清单，避免仅单项 consume 时冲掉文本塔/四件套的逐件门禁数据'
    ]
  },
  {
    id: 'port-and-debug-standards',
    title: '全系统端口规范与多 Worktree CDP 调试指南',
    docPath: 'docs/developer/infra/port-and-debug-standards.md',
    pathPatterns: [/port-and-debug/i, /remote-debugging-port/i, /cdp/i],
    keywords: ['端口', 'CDP', '调试端口', '端口规范', '端口表', 'remote-debugging-port', 'worktree 独占'],
    invariants: [
      '全系统端口统一归口高位冷门段 38100~38859：Vite 38100、Omni 38200、AI Skill API 38300、llama-server 38400、LibreOffice 38500、CDP 38600 起、Marketing 38800、Agent 38820、Admin 38840',
      '每个服务均具备「基准端口 + 冲突滑动自增（+20 范围探测）」机制，端口冲突时自动顺延而非报错',
      'CDP 每个 Worktree 独占 10 个端口槽位：主仓库 38600~38609，分支 Worktree 按名称哈希映射至 38610~38750（步长 10），槽位区间物理隔绝',
      '多实例防误触：各 Worktree 的 MCP/CDP 连接地址彼此独立、永不重叠，严禁 MCP 操控错其他 Worktree 实例',
      'CDP 端口可经启动参数显式固定（--remote-debugging-port=386xx），启动时控制台输出所属 Worktree 槽位提示'
    ]
  },
  {
    id: 'development-env',
    title: '脚本与环境变量规范 / 包导入与代码风格纪律',
    docPath: 'docs/developer/infra/DEVELOPMENT.md',
    pathPatterns: [/infra\/DEVELOPMENT/i, /DEVELOPMENT\.md/i, /env-utils/i, /getEnvValues/i],
    keywords: ['环境变量', '命名规范', '包导入', '脚本规范', 'getEnvValues', 'parseEnvFile', 'pnpm'],
    invariants: [
      '环境变量按三层合并优先级加载并覆盖：环境专属配置 (.env.production/.env.canary) ≻ 通用配置 (.env) ≻ 默认回退值',
      'scripts/ 目录下严禁各自重复实现 parseEnvFile，必须统一通过 scripts/utils/env-utils.js 的 getEnvValues(env) 读取',
      'Monorepo 内部包必须以 @firefly/* 包名导入并声明 workspace:* 版本，严禁相对路径跨包引用未导出的内部文件',
      '模块分层严格遵守 types ← core-engine ← desktop；出现循环引用风险时提取公共接口至 @firefly/types 或 @firefly/shared 以接口倒置解耦',
      '命名规范：接口/类型 PascalCase、函数与方法动词开头 camelCase、常量 UPPER_SNAKE_CASE、普通代码文件 kebab-case.ts、React 组件 PascalCase.tsx、测试文件 .test.ts/.spec.ts'
    ]
  },
  {
    id: 'project-structure-pro',
    title: 'Monorepo 包拓扑与 Open-Core / Pro 私有模块隔离机制',
    docPath: 'docs/developer/architecture/project-structure-and-pro.md',
    pathPatterns: [/project-structure/i, /submodule/i, /@pro/i, /resolveResourcePath/i, /resource-locator/i, /worktree-env/i],
    keywords: ['monorepo', '@pro', '子模块', 'submodule', '包拓扑', 'resolveResourcePath', 'pro-stub', 'ResourceLocator', 'worktree-env', 'isLocalDevRuntime', '热更新', '二进制监听', '日志刷屏', 'devBinaryWatch'],
    invariants: [
      'Monorepo + Git Submodule 双层隔离：apps/omni、apps/desktop、apps/desktop/pro、apps/ai-folder-organize 均为独立仓库子模块',
      '@pro 动态路径解析：存在 apps/desktop/pro/src 时指向闭源 Pro 源码，不存在时降级至开源存根 apps/desktop/src/shared/pro-stub（默认导出 isProVersion = false）',
      '构建资源查找统一走 resolveResourcePath：优先 pro/ → ee/ → src/pro，未命中平滑降级至 build/；严禁把 Pro 资源强行复制回开源 build/ 目录',
      '管理脚本与测试套件物理隔离在 apps/desktop/pro/scripts/ 与 apps/desktop/pro/tests/，经 node pro/scripts/run.js <scriptName> 统一调度',
      '开源仓库 .gitignore 必须锁定 pro/、scripts/、tests/、design/、ee/ 规则防私有模块泄露，历史提交记录已做清除化处理',
      '本地开发热更新监听与运行环境判定 SSOT：全系统统一经 worktree-env.ts::isLocalDevRuntime() 判定开发热更态（一票否决 app.isPackaged、NODE_ENV=production/test 等），严禁内联 || 宽松判断导致生产或单测泄露；ResourceLocator 对识别日志做进程生命周期首次去重，禁止频繁重复 debug 刷屏'
    ]
  },
  {
    id: 'application-phases',
    title: '应用启动三阶段与 AI 分析三阶段 / ConfigKey 统一配置',
    docPath: 'docs/developer/architecture/application-phases-definition.md',
    pathPatterns: [/application-phases/i, /config-orchestrator/i, /ConfigKey/i, /startup-phase/i],
    keywords: ['启动流程', '应用启动', 'AI 分析阶段', 'ConfigKey', '统一配置', '启动阶段'],
    invariants: [
      '应用启动三阶段严格分层：配置阶段（最小化初始化，仅日志/数据库/ConfigOrchestrator/系统健康检查/欢迎向导）→ 初始化阶段（一次性初始化全部 AI 相关服务）→ 运行时阶段（服务就绪直接响应请求）',
      '配置阶段严禁初始化 AI 服务实例、模型加载与能力检测；运行时阶段严禁重复初始化操作，模型切换走懒加载',
      'AI 分析三阶段固定数据流：第一阶段 FileAnalysisService（内容提取）→ 第二阶段 QualityScoringService（质量评分）→ 第三阶段 DimensionAnalyzer（维度分析）',
      '统一配置单一数据源 (SSOT) 为 apps/desktop/src/electron/config/config.default.ts 的 defaultUnifiedConfig；配置协调器深度合并默认配置 + electron-conf 用户覆盖 + 运行时动态配置',
      '配置变更经 config:change IPC 事件实时推送渲染进程；核心后端服务统一通过 ConfigKey 读取配置并自带回退机制，UI 层经 getConfigValue/updateConfigValue 访问'
    ]
  },
  {
    id: 'electron-45-dual-track',
    title: 'Windows/macOS 升级 Electron 45 与 Linux 保持 Electron 32 隔离演进',
    docPath: 'docs/specs/electron-45-dual-track-upgrade-spec.md',
    pathPatterns: [/rebuild.*\.js/i, /safe-clipboard/i, /clipboard/i, /firefly-ai-folder-desktop-release/i],
    keywords: ['electron-45', 'electron 45', 'electron-rebuild', 'rebuild:better-sqlite3', 'safeClipboard', 'clipboard', 'dual-track', '双轨'],
    invariants: [
      '双轨隔离铁律：Linux 构建严格保持 Electron 32.2.0 (Node 20 ABI / glibc 2.31+) 锁死，禁止强行升级破坏国产系统兼容',
      '主进程/Preload 语法天花板：代码严禁使用高于 Node 20.15.0 LTS 的语法/API（禁 Promise.withResolvers/Import Attributes/fs.glob 等）',
      '保留 better-sqlite3：坚决禁止替换为 node:sqlite，保障 FTS5 trigram、zstd 解压与事务完整性',
      '安全剪贴板契约：渲染层严禁直接 import electron.clipboard，统一经 safeClipboard IPC 通道或带失焦兜底的 navigator.clipboard'
    ]
  }
,
  {
    id: 'user-fulfillment-and-desktop-snapshot',
    title: '用户主体资产履约、微信支付闭环与桌面端统一快照 (PRD-0058 / Ticket 01-05)',
    docPath: 'docs/specs/user-fulfillment-and-desktop-read-snapshot-spec.md',
    pathPatterns: [
      /wxpay/i,
      /payment_orders/i,
      /apply_fulfillment/i,
      /rpc_get_device_bind_status/i,
      /rpc_get_user_transactions/i,
      /user-tier/i,
      /entitlement-utils/i
    ],
    keywords: [
      '微信支付',
      'wxpay',
      'apply_fulfillment',
      'rpc_get_device_bind_status',
      'rpc_get_user_transactions',
      'user_tier_data',
      'firecores',
      '萤火充值',
      'pending_claim',
      '履约'
    ],
    invariants: [
      'User SSOT 单一法定事实源：资产与会员全归属 users.user_tier_data，设备 (machines / user_devices) 仅作为接入 Slot 槽位，严禁将 machines 作为资产主体',
      '入账必达与挂载解耦：apply_fulfillment 内席位冲突 (conflict) 或满槽 (slot_full) 时，严禁阻断或回滚入账事务，标记 bind_result 照常到账',
      '固定两级锁序：履约核心按 payment_orders FOR UPDATE ➔ users FOR NO KEY UPDATE 严格递进加锁，绝不交叉反向加锁',
      '未绑定保护与统一快照：桌面端读时调用 rpc_get_device_bind_status，遇 pending_claim 状态保留资产提示，严禁返回 null 导致本地置零',
      '离线企业授权宿主底座：resolveEffectiveTier 中本地有效企业离线凭证 (localMachineLicense) 享最高优先级，断网或解绑恒保 ENTERPRISE 档位'
    ]
  }
]

// 获取 git status 变动文件列表
function getGitChangedFiles() {
  try {
    const out = execSync('git status --porcelain', { cwd: ROOT_DIR, encoding: 'utf-8' })
    return out
      .split(/\r?\n/)
      .filter(Boolean)
      .map(line => line.slice(3).trim().replace(/^"(.*)"$/, '$1'))
  } catch (_) {
    return []
  }
}

// 扫描源码文件头部的 @doc-anchor 注释以捕获绑定的 L3 Spec
function extractSourceDocAnchors(inputs) {
  const discoveredDocs = new Set()
  for (const item of inputs) {
    const fullPath = path.resolve(ROOT_DIR, item)
    if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
      const content = fs.readFileSync(fullPath, 'utf-8')
      const headLines = content.split(/\r?\n/).slice(0, 40).join('\n')
      const regex = /@doc-anchor\s*:\s*([^\s*]+)/g
      let m
      while ((m = regex.exec(headLines)) !== null) {
        discoveredDocs.add(m[1].trim())
      }
    }
  }
  return Array.from(discoveredDocs)
}

// 读取文档前 N 行中的 TOC 与心智模型摘要
function extractDocPreview(relDocPath, maxLines = 60) {
  const cleanRel = relDocPath.split('#')[0]
  const fullPath = path.join(ROOT_DIR, cleanRel)
  if (!fs.existsSync(fullPath)) return `⚠️ 文件不存在: ${cleanRel}`

  const lines = fs.readFileSync(fullPath, 'utf-8').split(/\r?\n/)
  const slice = lines.slice(0, Math.min(lines.length, maxLines))
  return slice.join('\n')
}

// 关键词匹配逻辑：英文短词采用单词边界正则匹配，防止类似 spec 误命中 specify
function matchKeyword(haystack, kw) {
  if (/^[a-zA-Z0-9_\-]+$/.test(kw)) {
    const escaped = kw.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')
    const rx = new RegExp(`\\b${escaped}\\b`, 'i')
    return rx.test(haystack)
  }
  return haystack.toLowerCase().includes(kw.toLowerCase())
}

function runRadar() {
  const args = process.argv.slice(2)
  const isJson = args.includes('--json')
  const useGit = args.includes('--git')
  const rawInputs = args.filter(a => !a.startsWith('--'))

  if (useGit) {
    rawInputs.push(...getGitChangedFiles())
  }

  const matchedRules = new Map()
  const combinedInputStr = rawInputs.join(' ')

  for (const rule of RADAR_RULES) {
    let hitReason = null
    for (const input of rawInputs) {
      if (rule.pathPatterns.some(rx => rx.test(input))) {
        hitReason = `路径/符号匹配 (${input})`
        break
      }
    }
    if (!hitReason && combinedInputStr) {
      const hitKw = rule.keywords.find(kw => matchKeyword(combinedInputStr, kw))
      if (hitKw) hitReason = `关键词匹配 ("${hitKw}")`
    }

    if (hitReason) {
      matchedRules.set(rule.id, { ...rule, hitReason })
    }
  }

  // 若未提供任何特定匹配，默认返回架构与受控概念两大基石
  if (matchedRules.size === 0) {
    matchedRules.set(RADAR_RULES[0].id, { ...RADAR_RULES[0], hitReason: '默认核心基线兜底' })
    matchedRules.set(RADAR_RULES[1].id, { ...RADAR_RULES[1], hitReason: '默认核心基线兜底' })
  }

  const explicitDocAnchors = extractSourceDocAnchors(rawInputs)

  if (isJson) {
    console.log(
      JSON.stringify(
        {
          matchedL2Hubs: Array.from(matchedRules.values()),
          sourceBoundDocs: explicitDocAnchors
        },
        null,
        2
      )
    )
    return
  }

  console.log(`================================================================`)
  console.log(`📡 Doc-Radar 确定性知识路由与业务心智简报 (防遗漏强制预检)`)
  console.log(`================================================================\n`)

  for (const item of matchedRules.values()) {
    console.log(`### 🎯 命中规范: ${item.title}`)
    console.log(`- **触发原因**: ${item.hitReason}`)
    console.log(`- **必读路径**: \`${item.docPath}\``)
    console.log(`- **核心业务心智与不变量 (Domain Invariants)**:`)
    item.invariants.forEach(inv => console.log(`  • ${inv}`))
    console.log(`\n#### 📑 文档前 55 行 (TOC 与导航速查预览):`)
    console.log('```markdown')
    console.log(extractDocPreview(item.docPath, 55))
    console.log('```\n----------------------------------------------------------------\n')
  }

  if (explicitDocAnchors.length > 0) {
    console.log(`### 🔗 源码头部 @doc-anchor 显式绑定的深度规格 (L3):`)
    explicitDocAnchors.forEach(d => console.log(`- \`${d}\` (请先读前 60 行 TOC 定向切片查阅)`))
    console.log('')
  }
}

runRadar()
