import type {
  AppSettings,
  Attachment,
  BasicProfile,
  BatchFillRequest,
  CommitCandidate,
  Database,
  DeAiPatchItem,
  DocFillAnalysis,
  DocFillAnswerInput,
  DocFillWriteRequest,
  DocFillWriteResult,
  Entry,
  ExportProofsOptions,
  ExportResumeOptions,
  ExtractInput,
  ExtractResult,
  FormFillItem,
  GenerateRequest,
  PolishFieldRequest,
  SchemaOverrides,
  SnapshotMeta,
  Snippet
} from './types'

/** 附件挂载目标：某条资料或基本信息 */
export type AttachTarget = { kind: 'entry'; entryId: string } | { kind: 'profile' }

/** 供解析用的文件内容 */
export type FilePayload =
  | { kind: 'pdf'; fileName: string; filePath: string; base64: string }
  | { kind: 'image'; fileName: string; filePath: string; dataUrl: string }
  | { kind: 'text'; fileName: string; filePath: string; text: string }
  | { kind: 'unsupported'; fileName: string; filePath: string }

export interface EntryUpsert {
  id?: string
  category: string
  data: Record<string, unknown>
  tags?: string[]
}

/**
 * 渲染进程可调用的全部接口（window.api）。
 * 每个方法通过 ipcRenderer.invoke(方法名, ...参数) 调用主进程同名 handler。
 */
export interface Api {
  // ---- 数据 ----
  getDb(): Promise<Database>
  saveProfile(data: Record<string, unknown>): Promise<BasicProfile>
  upsertEntry(e: EntryUpsert): Promise<Entry>
  deleteEntry(id: string): Promise<void>
  reorderEntries(category: string, orderedIds: string[]): Promise<void>
  saveSchema(schema: SchemaOverrides): Promise<SchemaOverrides>
  commitCandidates(list: CommitCandidate[], profilePatch?: Record<string, unknown>): Promise<Entry[]>
  saveSnippet(s: Omit<Snippet, 'id' | 'createdAt'> & { id?: string }): Promise<Snippet>
  deleteSnippet(id: string): Promise<void>
  /** 一键合并两条重复或冲突的条目（完整保留双方的非空字段、标签与物理附件文件） */
  mergeEntries(primaryId: string, secondaryId: string, fieldOverrides?: Record<string, unknown>): Promise<Entry>
  /** 历史快照时光机：获取快照列表、立即创建快照、一键回滚到指定快照 */
  listSnapshots(): Promise<SnapshotMeta[]>
  createSnapshot(): Promise<SnapshotMeta | null>
  restoreSnapshot(snapshotId: string): Promise<boolean>

  // ---- 文件 / 附件 ----
  pickFiles(opts?: { images?: boolean; multi?: boolean; docs?: boolean }): Promise<string[]>
  addAttachments(target: AttachTarget, filePaths: string[]): Promise<Attachment[]>
  addAttachmentFromBase64(target: AttachTarget, dataUrl: string, fileName?: string): Promise<Attachment>
  removeAttachment(target: AttachTarget, attachmentId: string): Promise<void>
  openAttachment(relPath: string): Promise<void>
  showAttachmentInFolder(relPath: string): Promise<void>
  /** 返回附件 dataURL（图片/PDF 预览用），超过 15MB 返回 null */
  attachmentDataUrl(relPath: string): Promise<string | null>
  setAvatar(filePath: string | null): Promise<BasicProfile>
  readFileForParse(filePath: string): Promise<FilePayload>

  // ---- 窗口 / 设置 ----
  getSettings(): Promise<AppSettings>
  saveSettings(s: Partial<AppSettings>): Promise<AppSettings>
  chooseDataDir(): Promise<AppSettings | null>
  getMiniMode(): Promise<boolean>
  setMiniMode(enabled: boolean): Promise<boolean>

  // ---- AI ----
  listModels(
    which: 'text' | 'vision',
    baseURL: string,
    apiKey?: string
  ): Promise<{ ok: boolean; models: string[]; recommended?: string; message?: string }>
  testConnection(which: 'text' | 'vision'): Promise<{ ok: boolean; message: string }>
  extractFromInputs(inputs: ExtractInput[]): Promise<ExtractResult>
  organizeText(text: string, categoryHint?: string): Promise<ExtractResult>
  /** 流式生成；通过 onAiStream 接收增量 */
  generateText(requestId: string, req: GenerateRequest): Promise<void>
  cancelGenerate(requestId: string): Promise<void>
  /** 表格/网申问题批量匹配答案 */
  batchFillForm(req: BatchFillRequest): Promise<FormFillItem[]>
  /** 单条目多行文本字段 AI 一键润色 */
  polishFieldText(req: PolishFieldRequest): Promise<string>
  /** 智能文件填表：解析待填文件（.docx/.txt/.md/.csv）并自动检索资料库/文献库匹配答案，未知项生成追问 */
  analyzeDocForFill(filePath: string): Promise<DocFillAnalysis>
  /** 智能文件填表：将用户对缺失问题的回答永久记入资料库（基本信息或问答记忆库） */
  saveDocFillAnswers(answers: DocFillAnswerInput[]): Promise<void>
  /** 智能文件填表：将填写内容写回原文件或另存为新文件（默认同文件夹） */
  writeFilledDoc(req: DocFillWriteRequest): Promise<DocFillWriteResult>
  /** 选择新文件保存路径（默认定位到原文件所在目录） */
  chooseSavePath(defaultPath: string): Promise<string | null>
  /** 扫描并生成简历「去 AI 味」平实化改写建议 */
  deAiResumePreview(entryIds?: string[]): Promise<DeAiPatchItem[]>
  /** 应用简历「去 AI 味」改写结果到资料库 */
  applyDeAiPatches(patches: DeAiPatchItem[]): Promise<void>

  // ---- 导出 ----
  resumeHtml(opts: ExportResumeOptions): Promise<string>
  exportResumePdf(opts: ExportResumeOptions): Promise<string | null>
  exportResumeDocx(opts: ExportResumeOptions): Promise<string | null>
  exportProofsBundle(opts: ExportProofsOptions): Promise<{ outPath: string; fileCount: number; entryCount: number } | null>
  backupZip(): Promise<string | null>
  restoreZip(): Promise<boolean>
  /** 打开任意本地文件或定位文件夹 */
  openExternalPath(absPath: string, revealInFolder?: boolean): Promise<void>
}

export type ApiMethod = keyof Api

export const API_METHODS: ApiMethod[] = [
  'getDb',
  'saveProfile',
  'upsertEntry',
  'deleteEntry',
  'reorderEntries',
  'saveSchema',
  'commitCandidates',
  'saveSnippet',
  'deleteSnippet',
  'mergeEntries',
  'listSnapshots',
  'createSnapshot',
  'restoreSnapshot',
  'pickFiles',
  'addAttachments',
  'addAttachmentFromBase64',
  'removeAttachment',
  'openAttachment',
  'showAttachmentInFolder',
  'attachmentDataUrl',
  'setAvatar',
  'readFileForParse',
  'getSettings',
  'saveSettings',
  'chooseDataDir',
  'getMiniMode',
  'setMiniMode',
  'listModels',
  'testConnection',
  'extractFromInputs',
  'organizeText',
  'generateText',
  'cancelGenerate',
  'batchFillForm',
  'polishFieldText',
  'analyzeDocForFill',
  'saveDocFillAnswers',
  'writeFilledDoc',
  'chooseSavePath',
  'deAiResumePreview',
  'applyDeAiPatches',
  'resumeHtml',
  'exportResumePdf',
  'exportResumeDocx',
  'exportProofsBundle',
  'backupZip',
  'restoreZip',
  'openExternalPath'
]

export type AiStreamEvent =
  | { requestId: string; type: 'delta'; text: string }
  | { requestId: string; type: 'done' }
  | { requestId: string; type: 'error'; message: string }

export const AI_STREAM_CHANNEL = 'ai:stream'

/** window 上暴露的完整对象 */
export interface WindowApi extends Api {
  onAiStream(cb: (e: AiStreamEvent) => void): () => void
  /** 拖拽文件时获取本地路径 */
  getPathForFile(file: File): string
}
