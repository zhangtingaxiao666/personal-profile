import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import type {
  Attachment,
  BasicProfile,
  CommitCandidate,
  Database,
  Entry,
  SchemaOverrides,
  SnapshotMeta,
  Snippet
} from '@shared/types'
import type { AttachTarget, EntryUpsert } from '@shared/ipc'
import { emptyOverrides, resolveCategories } from '@shared/categories'

const DB_FILE = 'db.json'
const SNAPSHOT_DIR = 'snapshots'
const MAX_SNAPSHOTS = 20
export const ATTACH_DIR = 'attachments'

export function emptyDb(): Database {
  return {
    version: 1,
    profile: { data: {}, attachments: [] },
    entries: [],
    snippets: [],
    schema: emptyOverrides()
  }
}

const now = () => new Date().toISOString()

/** 清理值：去掉 undefined / 空字符串 / 空数组 */
export function cleanData(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(data ?? {})) {
    if (v === undefined || v === null) continue
    if (typeof v === 'string' && v.trim() === '') continue
    if (Array.isArray(v)) {
      const arr = v.map((x) => (typeof x === 'string' ? x.trim() : x)).filter((x) => x !== '' && x != null)
      if (arr.length === 0) continue
      out[k] = arr
      continue
    }
    out[k] = typeof v === 'string' ? v.trim() : v
  }
  return out
}

function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').slice(-120)
}

const MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.zip': 'application/zip'
}
export function mimeOf(file: string): string {
  return MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream'
}

export class Store {
  private db: Database
  constructor(public dataDir: string) {
    fs.mkdirSync(path.join(dataDir, ATTACH_DIR), { recursive: true })
    this.db = this.load()
  }

  // ---------- 持久化 ----------
  private load(): Database {
    const file = path.join(this.dataDir, DB_FILE)
    if (!fs.existsSync(file)) {
      const snap = this.listSnapshots().pop()
      if (snap) {
        try {
          return this.migrate(JSON.parse(fs.readFileSync(snap, 'utf-8')))
        } catch {
          // ignore
        }
      }
      return emptyDb()
    }
    try {
      const content = fs.readFileSync(file, 'utf-8').trim()
      if (!content) throw new Error('empty db file')
      const raw = JSON.parse(content)
      return this.migrate(raw)
    } catch (e) {
      // 主文件损坏：尝试最近的快照
      const snaps = this.listSnapshots().reverse()
      for (const snap of snaps) {
        try {
          const raw = JSON.parse(fs.readFileSync(snap, 'utf-8'))
          return this.migrate(raw)
        } catch {
          // try previous snapshot
        }
      }
      throw new Error('数据文件损坏且无可用快照：' + (e as Error).message)
    }
  }

  private migrate(raw: Partial<Database>): Database {
    const base = emptyDb()
    return {
      version: 1,
      profile: { ...base.profile, ...(raw.profile ?? {}) },
      entries: raw.entries ?? [],
      snippets: raw.snippets ?? [],
      schema: { ...base.schema, ...(raw.schema ?? {}) }
    }
  }

  private listSnapshots(): string[] {
    const dir = path.join(this.dataDir, SNAPSHOT_DIR)
    if (!fs.existsSync(dir)) return []
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .map((f) => path.join(dir, f))
  }

  private lastSnapshotAt = 0
  /** 原子写入：写 tmp 再 rename；每 1 分钟最多自动做一次快照 */
  private persist(): void {
    const file = path.join(this.dataDir, DB_FILE)
    const tmp = file + '.tmp'
    const json = JSON.stringify(this.db, null, 2)
    if (fs.existsSync(file) && Date.now() - this.lastSnapshotAt > 60 * 1000) {
      this.snapshot()
      this.lastSnapshotAt = Date.now()
    }
    fs.writeFileSync(tmp, json, 'utf-8')
    fs.renameSync(tmp, file)
  }

  snapshot(): string | null {
    const file = path.join(this.dataDir, DB_FILE)
    if (!fs.existsSync(file)) return null
    const dir = path.join(this.dataDir, SNAPSHOT_DIR)
    fs.mkdirSync(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const snapName = `db-${stamp}.json`
    const snapPath = path.join(dir, snapName)
    fs.copyFileSync(file, snapPath)
    const snaps = this.listSnapshots()
    while (snaps.length > MAX_SNAPSHOTS) fs.rmSync(snaps.shift()!)
    return snapPath
  }

  private parseSnapshotMeta(snapPath: string): SnapshotMeta | null {
    try {
      const stat = fs.statSync(snapPath)
      const raw = JSON.parse(fs.readFileSync(snapPath, 'utf-8')) as Partial<Database>
      const db = this.migrate(raw)
      const cats = resolveCategories(db.schema)
      const catCounts: string[] = []
      for (const c of cats) {
        const cnt = db.entries.filter((e) => e.category === c.id).length
        if (cnt > 0) catCounts.push(`${c.label}(${cnt})`)
      }
      const profileFieldCount = Object.keys(db.profile?.data ?? {}).length
      const summaryParts: string[] = []
      if (profileFieldCount > 0) summaryParts.push(`基本信息(${profileFieldCount}项)`)
      if (catCounts.length > 0) summaryParts.push(catCounts.join(' · '))
      if (db.snippets.length > 0) summaryParts.push(`文案库(${db.snippets.length}篇)`)

      return {
        id: path.basename(snapPath),
        createdAt: stat.mtime.toISOString(),
        size: stat.size,
        entryCount: db.entries.length,
        snippetCount: db.snippets.length,
        profileName: String(db.profile?.data?.name ?? '未命名'),
        summary: summaryParts.join(' ｜ ') || '空资料库'
      }
    } catch {
      return null
    }
  }

  /** 获取全部历史快照列表（按时间倒序，最新在前） */
  listSnapshotMetas(): SnapshotMeta[] {
    const snaps = this.listSnapshots().reverse()
    const out: SnapshotMeta[] = []
    for (const p of snaps) {
      const meta = this.parseSnapshotMeta(p)
      if (meta) out.push(meta)
    }
    return out
  }

  /** 立即手动创建一份当前数据库的快照 */
  createSnapshotNow(): SnapshotMeta | null {
    const file = path.join(this.dataDir, DB_FILE)
    if (!fs.existsSync(file)) {
      fs.writeFileSync(file, JSON.stringify(this.db, null, 2), 'utf-8')
    }
    const snapPath = this.snapshot()
    this.lastSnapshotAt = Date.now()
    return snapPath ? this.parseSnapshotMeta(snapPath) : null
  }

  /** 从指定的历史快照一键恢复（恢复前先对当前状态做一份安全快照） */
  restoreSnapshot(snapshotId: string): boolean {
    const safeName = path.basename(snapshotId)
    const snapPath = path.join(this.dataDir, SNAPSHOT_DIR, safeName)
    if (!fs.existsSync(snapPath)) {
      throw new Error(`找不到指定的历史快照：${safeName}`)
    }
    // 校验快照合法性
    const targetDb = this.migrate(JSON.parse(fs.readFileSync(snapPath, 'utf-8')))
    // 先把当前数据库备份一份快照，确保回滚操作本身也可随时后悔撤回
    this.snapshot()
    this.db = targetDb
    const file = path.join(this.dataDir, DB_FILE)
    const tmp = file + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(this.db, null, 2), 'utf-8')
    fs.renameSync(tmp, file)
    this.lastSnapshotAt = Date.now()
    return true
  }

  /** 从磁盘重新加载（恢复备份后调用） */
  reload(): void {
    this.db = this.load()
  }

  // ---------- 读取 ----------
  getDb(): Database {
    return structuredClone(this.db)
  }
  getEntry(id: string): Entry | undefined {
    return this.db.entries.find((e) => e.id === id)
  }

  // ---------- 基本信息 ----------
  saveProfile(data: Record<string, unknown>): BasicProfile {
    this.db.profile.data = cleanData({ ...this.db.profile.data, ...data })
    this.persist()
    return structuredClone(this.db.profile)
  }

  patchProfile(patch: Record<string, unknown>): void {
    const clean = cleanData(patch)
    for (const [k, v] of Object.entries(clean)) {
      const cur = this.db.profile.data[k]
      if (cur == null || cur === '' || (Array.isArray(cur) && cur.length === 0)) this.db.profile.data[k] = v
    }
    this.persist()
  }

  setAvatar(relPath: string | undefined): BasicProfile {
    const old = this.db.profile.avatarRelPath
    if (old && old !== relPath) this.removeFileQuiet(old)
    this.db.profile.avatarRelPath = relPath
    this.persist()
    return structuredClone(this.db.profile)
  }

  // ---------- 条目 ----------
  upsertEntry(u: EntryUpsert, source: Entry['source'] = 'manual'): Entry {
    const t = now()
    if (u.id) {
      const e = this.db.entries.find((x) => x.id === u.id)
      if (!e) throw new Error('条目不存在：' + u.id)
      e.data = cleanData({ ...e.data, ...u.data })
      if (u.tags) e.tags = u.tags
      e.category = u.category
      e.updatedAt = t
      this.persist()
      return structuredClone(e)
    }
    const maxOrder = Math.max(-1, ...this.db.entries.filter((x) => x.category === u.category).map((x) => x.order))
    const e: Entry = {
      id: randomUUID(),
      category: u.category,
      data: cleanData(u.data),
      tags: u.tags ?? [],
      attachments: [],
      source,
      order: maxOrder + 1,
      createdAt: t,
      updatedAt: t
    }
    this.db.entries.push(e)
    this.persist()
    return structuredClone(e)
  }

  deleteEntry(id: string): void {
    const idx = this.db.entries.findIndex((e) => e.id === id)
    if (idx === -1) return
    this.db.entries.splice(idx, 1)
    fs.rmSync(path.join(this.dataDir, ATTACH_DIR, id), { recursive: true, force: true })
    this.persist()
  }

  reorderEntries(category: string, orderedIds: string[]): void {
    orderedIds.forEach((id, i) => {
      const e = this.db.entries.find((x) => x.id === id && x.category === category)
      if (e) e.order = i
    })
    this.persist()
  }

  /**
   * 一键无损合并两条重复或冲突条目：
   * - 将 secondary 的非空字段合并进 primary（primary 已有非空字段优先，除非在 fieldOverrides 中指定覆盖值）
   * - 合并双方标签
   * - 将 secondary 的物理附件文件迁移至 primary 的附件目录并合并附件列表
   * - 删除 secondary 条目
   */
  mergeEntries(
    primaryId: string,
    secondaryId: string,
    fieldOverrides?: Record<string, unknown>
  ): Entry {
    if (primaryId === secondaryId) {
      const cur = this.getEntry(primaryId)
      if (!cur) throw new Error('条目不存在：' + primaryId)
      return structuredClone(cur)
    }
    const primary = this.getEntry(primaryId)
    const secondary = this.getEntry(secondaryId)
    if (!primary) throw new Error('主条目不存在：' + primaryId)
    if (!secondary) throw new Error('待合并条目不存在：' + secondaryId)

    // 1. 合并字段：secondary 补充 primary 缺失字段，再应用显式指定的冲突解决方案 fieldOverrides
    const mergedData = cleanData({
      ...secondary.data,
      ...primary.data,
      ...(fieldOverrides ?? {})
    })
    primary.data = mergedData
    primary.tags = [...new Set([...(primary.tags ?? []), ...(secondary.tags ?? [])])]
    primary.updatedAt = now()

    // 2. 迁移 secondary 的物理附件文件到 primary 目录（按文件名去重）
    const existingNames = new Set(primary.attachments.map((a) => a.fileName))
    for (const att of secondary.attachments ?? []) {
      try {
        const srcAbs = this.abs(att.relPath)
        if (fs.existsSync(srcAbs) && !existingNames.has(att.fileName)) {
          const { relPath, size } = this.importFile(srcAbs, primary.id)
          primary.attachments.push({
            id: randomUUID(),
            fileName: att.fileName,
            relPath,
            mime: att.mime,
            size,
            addedAt: att.addedAt || now()
          })
          existingNames.add(att.fileName)
        }
      } catch {
        // ignore missing attachment file
      }
    }

    // 3. 删除 secondary 条目及其原附件目录
    this.deleteEntry(secondaryId)
    return structuredClone(primary)
  }

  // ---------- 附件 ----------
  private targetAttachments(target: AttachTarget): Attachment[] {
    if (target.kind === 'profile') return this.db.profile.attachments
    const e = this.getEntry(target.entryId)
    if (!e) throw new Error('条目不存在：' + target.entryId)
    return e.attachments
  }

  /** 复制外部文件到数据目录，返回相对路径 */
  importFile(srcPath: string, folder: string): { relPath: string; size: number } {
    const id = randomUUID().slice(0, 8)
    const rel = path.posix.join(ATTACH_DIR, folder, `${id}_${safeFileName(path.basename(srcPath))}`)
    const abs = this.abs(rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.copyFileSync(srcPath, abs)
    return { relPath: rel, size: fs.statSync(abs).size }
  }

  addAttachments(target: AttachTarget, filePaths: string[]): Attachment[] {
    const list = this.targetAttachments(target)
    const folder = target.kind === 'profile' ? '_profile' : target.entryId
    const added: Attachment[] = []
    for (const p of filePaths) {
      if (!fs.existsSync(p) || fs.statSync(p).isDirectory()) continue
      const { relPath, size } = this.importFile(p, folder)
      const a: Attachment = {
        id: randomUUID(),
        fileName: path.basename(p),
        relPath,
        mime: mimeOf(p),
        size,
        addedAt: now()
      }
      list.push(a)
      added.push(a)
    }
    if (target.kind === 'entry') this.getEntry(target.entryId)!.updatedAt = now()
    this.persist()
    return added
  }

  /** 从剪贴板图片/文件 DataURL 直接保存为证明附件 */
  addAttachmentFromBase64(target: AttachTarget, dataUrl: string, fileName?: string): Attachment {
    const m = /^data:([^;]+);base64,(.+)$/.exec(dataUrl)
    if (!m) throw new Error('无效的剪贴板或图片数据格式')
    const mime = m[1].toLowerCase()
    const buf = Buffer.from(m[2], 'base64')
    const extMap: Record<string, string> = {
      'image/png': '.png',
      'image/jpeg': '.jpg',
      'image/webp': '.webp',
      'image/gif': '.gif',
      'image/bmp': '.bmp',
      'application/pdf': '.pdf'
    }
    const ext = extMap[mime] ?? '.png'
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15)
    const rawName = fileName?.trim() || `剪贴板截图_${stamp}${ext}`
    const finalName = path.extname(rawName) ? rawName : rawName + ext

    const list = this.targetAttachments(target)
    const folder = target.kind === 'profile' ? '_profile' : target.entryId
    const id = randomUUID().slice(0, 8)
    const relPath = path.posix.join(ATTACH_DIR, folder, `${id}_${safeFileName(finalName)}`)
    const abs = this.abs(relPath)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, buf)

    const a: Attachment = {
      id: randomUUID(),
      fileName: finalName,
      relPath,
      mime,
      size: buf.length,
      addedAt: now()
    }
    list.push(a)
    if (target.kind === 'entry') this.getEntry(target.entryId)!.updatedAt = now()
    this.persist()
    return a
  }

  removeAttachment(target: AttachTarget, attachmentId: string): void {
    const list = this.targetAttachments(target)
    const i = list.findIndex((a) => a.id === attachmentId)
    if (i === -1) return
    const [a] = list.splice(i, 1)
    this.removeFileQuiet(a.relPath)
    this.persist()
  }

  abs(relPath: string): string {
    const abs = path.resolve(this.dataDir, relPath)
    if (!abs.startsWith(path.resolve(this.dataDir))) throw new Error('非法路径')
    return abs
  }

  private removeFileQuiet(relPath: string): void {
    try {
      fs.rmSync(this.abs(relPath), { force: true })
    } catch {
      /* ignore */
    }
  }

  // ---------- AI 候选入库 ----------
  commitCandidates(list: CommitCandidate[], profilePatch?: Record<string, unknown>): Entry[] {
    const result: Entry[] = []
    for (const c of list) {
      let entry: Entry
      if (c.mergeInto && this.getEntry(c.mergeInto)) {
        const e = this.getEntry(c.mergeInto)!
        const merged = { ...e.data }
        for (const [k, v] of Object.entries(cleanData(c.data))) merged[k] = v
        entry = this.upsertEntry({ id: e.id, category: e.category, data: merged, tags: [...new Set([...e.tags, ...c.tags])] })
      } else {
        entry = this.upsertEntry({ category: c.category, data: c.data, tags: c.tags }, 'ai')
      }
      const existingNames = new Set(this.getEntry(entry.id)!.attachments.map((a) => a.fileName))
      const files = c.sourceFiles.filter((f) => !existingNames.has(path.basename(f)))
      if (files.length) this.addAttachments({ kind: 'entry', entryId: entry.id }, files)
      result.push(structuredClone(this.getEntry(entry.id)!))
    }
    if (profilePatch && Object.keys(profilePatch).length) this.patchProfile(profilePatch)
    else this.persist()
    return result
  }

  // ---------- schema ----------
  saveSchema(schema: SchemaOverrides): SchemaOverrides {
    this.db.schema = structuredClone(schema)
    this.persist()
    return structuredClone(this.db.schema)
  }

  // ---------- 文案库 ----------
  saveSnippet(s: Omit<Snippet, 'id' | 'createdAt'> & { id?: string }): Snippet {
    if (s.id) {
      const cur = this.db.snippets.find((x) => x.id === s.id)
      if (cur) {
        Object.assign(cur, s)
        this.persist()
        return structuredClone(cur)
      }
    }
    const sn: Snippet = { ...s, id: randomUUID(), createdAt: now() }
    this.db.snippets.unshift(sn)
    this.persist()
    return structuredClone(sn)
  }

  deleteSnippet(id: string): void {
    this.db.snippets = this.db.snippets.filter((s) => s.id !== id)
    this.persist()
  }
}
