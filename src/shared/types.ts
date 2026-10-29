// 全局共享类型定义（主进程 / 预加载 / 渲染进程共用）

export type FieldType =
  | 'text'
  | 'textarea'
  | 'date'
  | 'month'
  | 'select'
  | 'tags'
  | 'url'
  | 'number'

export interface FieldDef {
  key: string
  label: string
  type: FieldType
  required?: boolean
  options?: string[]
  /** 敏感字段：界面打码，且不会发送给 AI */
  sensitive?: boolean
  placeholder?: string
  /** 被用户隐藏（字段管理） */
  hidden?: boolean
  /** 用户自定义字段 */
  custom?: boolean
}

export interface CategoryDef {
  id: string
  label: string
  /** antd icon 名称 */
  icon: string
  /** 卡片标题使用的字段 key */
  titleField: string
  /** 卡片副标题使用的字段 key（可选） */
  subtitleFields?: string[]
  fields: FieldDef[]
  /** 用户自定义分类 */
  custom?: boolean
  hidden?: boolean
  /** 给 AI 的分类说明 */
  aiHint?: string
}

/** 用户对 schema 的修改（与内置定义合并） */
export interface SchemaOverrides {
  /** 分类级修改，key 为分类 id；'profile' 表示基本信息 */
  categories: Record<
    string,
    {
      label?: string
      hidden?: boolean
      /** 字段覆盖：重命名 / 隐藏 */
      fieldPatches?: Record<string, { label?: string; hidden?: boolean }>
      /** 用户新增的字段 */
      extraFields?: FieldDef[]
      /** 字段显示顺序（key 列表） */
      fieldOrder?: string[]
    }
  >
  /** 用户自定义的新分类 */
  customCategories: CategoryDef[]
  /** 分类显示顺序 */
  categoryOrder?: string[]
}

export interface Attachment {
  id: string
  fileName: string
  /** 相对数据目录的路径 */
  relPath: string
  mime: string
  size: number
  addedAt: string
  note?: string
}

export interface Entry {
  id: string
  category: string
  data: Record<string, unknown>
  tags: string[]
  attachments: Attachment[]
  source: 'manual' | 'ai'
  order: number
  createdAt: string
  updatedAt: string
}

export interface BasicProfile {
  /** 基本信息字段值，key 对应 PROFILE_FIELDS（含自定义字段） */
  data: Record<string, unknown>
  avatarRelPath?: string
  attachments: Attachment[]
}

export interface Snippet {
  id: string
  title: string
  requirement: string
  content: string
  wordLimit?: number
  createdAt: string
}

export interface Database {
  version: 1
  profile: BasicProfile
  entries: Entry[]
  snippets: Snippet[]
  schema: SchemaOverrides
}

// ---------- 设置 ----------
export interface ModelConfig {
  baseURL: string
  model: string
  /** 仅在渲染进程表单中传入；读取时不回传明文，用 hasKey 表示 */
  apiKey?: string
  hasKey?: boolean
}

export interface AppSettings {
  dataDir: string
  text: ModelConfig
  vision: ModelConfig
  /** 视觉模型未配置时是否复用文本模型配置 */
  visionSameAsText: boolean
}

export interface FieldConflict {
  fieldKey: string
  fieldLabel: string
  existingValue: string
  incomingValue: string
  /** 冲突原因分析提示（如：不同绩点算法 vs 不同学期成绩） */
  hint: string
  /** 并存合并值建议（如 "3.92/4.0（百分制 91.5）"） */
  combinedValue?: string
}

// ---------- AI ----------
export interface CandidateEntry {
  /** 临时 id */
  tempId: string
  category: string
  data: Record<string, unknown>
  tags: string[]
  /** 来源文件（绝对路径），确认后作为证明附件 */
  sourceFiles: string[]
  /** 疑似重复的已有条目 id */
  duplicateOf?: string
  /** 与已有条目存在的值冲突明细 */
  conflicts?: FieldConflict[]
}

export interface ExtractResult {
  candidates: CandidateEntry[]
  /** 对基本信息的建议值 */
  profilePatch: Record<string, unknown>
  warnings: string[]
}

/** 渲染进程预处理后的输入 */
export interface ExtractInput {
  /** 原始文件绝对路径（若有） */
  filePath?: string
  fileName?: string
  /** 已提取的文本 */
  text?: string
  /** 图片 dataURL 列表（扫描件 / 照片） */
  images?: string[]
}

export interface GenerateRequest {
  requirement: string
  wordLimit?: number
  tone?: 'formal' | 'concise' | 'warm'
  /** 指定使用的条目 id；为空则使用全部 */
  entryIds?: string[]
  includeProfile?: boolean
  /** 针对已生成文本提出修改意见时的当前文本草稿 */
  currentText?: string
  /** 用户提出的针对性修改意见（如“去掉在XX方面的死板结构”、“更口语化”） */
  refineFeedback?: string
}

export interface CommitCandidate {
  category: string
  data: Record<string, unknown>
  tags: string[]
  sourceFiles: string[]
  /** 合并到已有条目（覆盖非空字段 + 追加附件） */
  mergeInto?: string
}

export type ResumeTheme = 'classic' | 'modern' | 'academic'
export type ResumeDensity = 'compact' | 'normal' | 'loose'

export interface ExportResumeOptions {
  categories: string[]
  entryIds?: string[]
  includePhoto?: boolean
  title?: string
  /** 简历风格主题：classic=经典黑白干练风(默认去AI模板感) | modern=现代深蓝 | academic=学术严谨 */
  theme?: ResumeTheme
  /** 排版紧凑度：compact=紧凑一页纸模式 | normal=标准适中 | loose=舒展充实 */
  density?: ResumeDensity
}

/** 证明材料按规范重命名打包导出选项 */
export interface ExportProofsOptions {
  /** 指定要导出的条目 id 列表；为空则按 categories 过滤 */
  entryIds?: string[]
  categories?: string[]
  /** 是否包含基本信息下的证明文件（如身份证、学生证） */
  includeProfileAttachments?: boolean
  /** 命名规则：序号_分类_标题 | 分类_标题 | 序号_标题 */
  namingPattern?: 'index_cat_title' | 'cat_title' | 'index_title'
  /** 是否在压缩包内生成《00_证明材料目录清单.txt》 */
  includeIndexFile?: boolean
}

/** 表格/网申批量智能填表请求 */
export interface BatchFillRequest {
  /** 粘贴的表格栏目名称、问题列表或说明 */
  fieldsText?: string
  /** 粘贴或上传的表格截图 dataURL */
  imageDataUrl?: string
}

export interface FormFillItem {
  field: string
  value: string
  note?: string
}

/** 单字段 AI 润色请求 */
export interface PolishFieldRequest {
  categoryLabel: string
  fieldLabel: string
  rawText: string
  entryContext?: Record<string, unknown>
}

/** 智能文件填表：单个待填位置（单元格/段落/文本行） */
export interface DocFillSlot {
  /** 位置锚点标识：如 "tc:0:1:2"（表格0第1行第2列）或 "p:3"（第3段落）或 "line:5" */
  slotId: string
  /** 识别出的栏目/问题名称，如 "姓名"、"学号"、"代表性科研成果与论文" */
  label: string
  /** 原文件中该位置原有文字（通常为空、下划线或占位符） */
  currentText: string
  /** filled=已在资料库/文献库找到并填好；missing=资料库未找到，需询问用户（严禁编造） */
  status: 'filled' | 'missing'
  /** 填入的值（missing 时为空字符串，待用户回答后填入） */
  value: string
  /** 检索命中的资料来源说明，如 "基本信息-姓名"、"论文发表(2篇)"、"已存问答库" */
  source?: string
  /** 当 status === 'missing' 时向用户提出的具体问题 */
  question?: string
  /** 用户回答后记入资料库的目标字段名或问答标题 */
  saveKey?: string
  /** 用户回答后保存类型：profile=记入基本信息字段，snippet=记入文案问答库 */
  saveKind?: 'profile' | 'snippet'
  /** 是否为证件照/个人照片单元格（写入 .docx 时自动嵌入一寸证件照图片） */
  isPhoto?: boolean
}

export interface DocFillAnalysis {
  filePath: string
  fileName: string
  /** 默认建议的新文件保存路径（与原文件同一文件夹：原文件名_已填写.ext） */
  defaultNewPath: string
  slots: DocFillSlot[]
}

export interface DocFillAnswerInput {
  slotId: string
  label: string
  answer: string
  saveKey?: string
  saveKind?: 'profile' | 'snippet'
}

export interface DocFillWriteRequest {
  sourcePath: string
  /** overwrite=直接在原文件上填写并覆盖；newFile=另存为新文件 */
  mode: 'overwrite' | 'newFile'
  /** 当 mode === 'newFile' 时的目标保存路径（为空则默认存在原文件同目录） */
  targetPath?: string
  slots: { slotId: string; value: string }[]
}

export interface DocFillWriteResult {
  outPath: string
  filledCount: number
}

/** 简历去 AI 味改写建议项 */
export interface DeAiPatchItem {
  targetType: 'profile' | 'entry'
  entryId?: string
  title: string
  fieldKey: string
  fieldLabel: string
  original: string
  revised: string
}

/** 历史快照时光机元数据 */
export interface SnapshotMeta {
  /** 快照文件名，如 db-2026-10-29T07-30-00-000Z.json */
  id: string
  /** 快照创建时间 ISO 字符串 */
  createdAt: string
  /** 快照文件字节大小 */
  size: number
  /** 包含的经历条目总数 */
  entryCount: number
  /** 包含的文案数量 */
  snippetCount: number
  /** 快照中的姓名 */
  profileName: string
  /** 分类统计摘要，如 "教育经历(1) · 获奖荣誉(4) · 科研经历(2)" */
  summary: string
}

