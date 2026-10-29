import fs from 'fs'
import path from 'path'
import AdmZip from 'adm-zip'
import type { Attachment, Database, Entry, ExportProofsOptions } from '@shared/types'
import { entryTitle, formatValue, periodText, resolveCategories } from '@shared/categories'

export function createBackup(dataDir: string, outPath: string): void {
  const zip = new AdmZip()

  // 1. 打包 db.json
  const dbFile = path.join(dataDir, 'db.json')
  if (fs.existsSync(dbFile) && fs.statSync(dbFile).isFile()) {
    zip.addLocalFile(dbFile)
  }

  // 2. 打包 attachments/
  const attachDir = path.join(dataDir, 'attachments')
  if (fs.existsSync(attachDir) && fs.statSync(attachDir).isDirectory()) {
    zip.addLocalFolder(attachDir, 'attachments')
  }

  // 3. 写入 manifest.json
  const manifest = {
    app: '个人画像',
    version: 1,
    createdAt: new Date().toISOString()
  }
  zip.addFile('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2), 'utf-8'))

  // 确保目标路径所在目录存在
  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  zip.writeZip(outPath)
}

export function restoreBackup(zipPath: string, dataDir: string): void {
  if (!fs.existsSync(zipPath)) {
    throw new Error('不是有效的个人画像备份文件')
  }

  let zip: AdmZip
  try {
    zip = new AdmZip(zipPath)
  } catch {
    throw new Error('不是有效的个人画像备份文件')
  }

  const manifestEntry = zip.getEntry('manifest.json')
  const dbEntry = zip.getEntry('db.json')
  if (!manifestEntry || !dbEntry) {
    throw new Error('不是有效的个人画像备份文件')
  }

  try {
    const manifestJson = JSON.parse(manifestEntry.getData().toString('utf-8'))
    if (manifestJson?.app !== '个人画像') {
      throw new Error('不是有效的个人画像备份文件')
    }
  } catch (e) {
    if ((e as Error).message === '不是有效的个人画像备份文件') throw e
    throw new Error('不是有效的个人画像备份文件')
  }

  try {
    JSON.parse(dbEntry.getData().toString('utf-8'))
  } catch {
    throw new Error('不是有效的个人画像备份文件')
  }

  const entries = zip.getEntries()
  for (const entry of entries) {
    const entryName = entry.entryName
    const normalized = entryName.replace(/\\/g, '/')
    if (
      normalized.split('/').includes('..') ||
      path.isAbsolute(entryName) ||
      entryName.startsWith('/') ||
      entryName.startsWith('\\') ||
      /^[a-zA-Z]:/.test(entryName)
    ) {
      throw new Error('不是有效的个人画像备份文件')
    }
  }

  // 校验通过后：删除 dataDir 下现有 db.json 与 attachments/
  const curDb = path.join(dataDir, 'db.json')
  const curAttach = path.join(dataDir, 'attachments')
  if (fs.existsSync(curDb)) {
    fs.rmSync(curDb, { force: true })
  }
  if (fs.existsSync(curAttach)) {
    fs.rmSync(curAttach, { recursive: true, force: true })
  }

  // 再解压 db.json 与 attachments/**
  fs.mkdirSync(dataDir, { recursive: true })
  for (const entry of entries) {
    const normalized = entry.entryName.replace(/\\/g, '/')
    if (normalized === 'db.json') {
      const dest = path.join(dataDir, 'db.json')
      fs.mkdirSync(path.dirname(dest), { recursive: true })
      fs.writeFileSync(dest, entry.getData())
    } else if (normalized === 'attachments' || normalized.startsWith('attachments/')) {
      const targetPath = path.join(dataDir, normalized)
      const rel = path.relative(dataDir, targetPath)
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        throw new Error('备份文件包含非法路径条目')
      }
      if (entry.isDirectory) {
        fs.mkdirSync(targetPath, { recursive: true })
      } else {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true })
        fs.writeFileSync(targetPath, entry.getData())
      }
    }
  }
}

function cleanFilePart(s: string): string {
  return s
    .replace(/[\\/:*?"<>|\r\n]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60)
}

/**
 * 导出按规范重命名的证明材料包（用于提交奖学金/保研/网申审核）
 */
export function exportProofsZip(
  db: Database,
  opts: ExportProofsOptions,
  absOf: (rel: string) => string,
  outPath: string
): { fileCount: number; entryCount: number } {
  const cats = resolveCategories(db.schema).filter((c) => !c.hidden)
  const catMap = new Map(cats.map((c) => [c.id, c]))
  const pattern = opts.namingPattern ?? 'index_cat_title'
  const includeIndex = opts.includeIndexFile ?? true

  interface ProofGroup {
    catLabel: string
    title: string
    subtitle: string
    period: string
    attachments: Attachment[]
  }

  const groups: ProofGroup[] = []

  if (opts.includeProfileAttachments && db.profile.attachments.length > 0) {
    groups.push({
      catLabel: '基本信息',
      title: String(db.profile.data.name ?? '个人证明'),
      subtitle: '',
      period: '',
      attachments: db.profile.attachments
    })
  }

  let selectedEntries: Entry[] = []
  if (opts.entryIds && opts.entryIds.length > 0) {
    const idSet = new Set(opts.entryIds)
    selectedEntries = db.entries.filter((e) => idSet.has(e.id) && e.attachments.length > 0)
  } else {
    const allowedCats = opts.categories ? new Set(opts.categories) : new Set(cats.map((c) => c.id))
    for (const c of cats) {
      if (!allowedCats.has(c.id)) continue
      const inCat = db.entries
        .filter((e) => e.category === c.id && e.attachments.length > 0)
        .sort((a, b) => a.order - b.order)
      selectedEntries.push(...inCat)
    }
  }

  for (const e of selectedEntries) {
    const def = catMap.get(e.category)
    const catLabel = def?.label ?? e.category
    const title = entryTitle(def, e.data)
    const subtitle = (def?.subtitleFields ?? [])
      .map((k) => formatValue(e.data[k]))
      .filter(Boolean)
      .join(' · ')
    const period = periodText(e.data)
    groups.push({
      catLabel,
      title,
      subtitle,
      period,
      attachments: e.attachments
    })
  }

  const zip = new AdmZip()
  const usedNames = new Set<string>()
  const indexLines: string[] = [
    `================ 证明材料目录清单 ================`,
    `姓名：${String(db.profile.data.name ?? '未填写')}`,
    `导出时间：${new Date().toLocaleString('zh-CN')}`,
    `==================================================`,
    ''
  ]

  let fileCount = 0
  let entryCount = 0

  groups.forEach((g, idx) => {
    const validAtts = g.attachments.filter((a) => {
      try {
        return fs.existsSync(absOf(a.relPath))
      } catch {
        return false
      }
    })
    if (validAtts.length === 0) return
    entryCount++
    const numStr = String(entryCount).padStart(2, '0')
    const safeCat = cleanFilePart(g.catLabel)
    const safeTitle = cleanFilePart(g.title)
    const safeSub = cleanFilePart(g.subtitle)
    const titleWithSub = safeSub ? `${safeTitle}(${safeSub})` : safeTitle

    let basePrefix: string
    if (pattern === 'cat_title') {
      basePrefix = `${safeCat}_${titleWithSub}`
    } else if (pattern === 'index_title') {
      basePrefix = `${numStr}_${titleWithSub}`
    } else {
      basePrefix = `${numStr}_${safeCat}_${titleWithSub}`
    }

    const exportedNames: string[] = []
    validAtts.forEach((att, attIdx) => {
      const abs = absOf(att.relPath)
      const ext = path.extname(att.fileName) || path.extname(abs) || ''
      const suffix = validAtts.length > 1 ? `_${attIdx + 1}` : ''
      let candidate = `${basePrefix}${suffix}${ext}`
      let dup = 2
      while (usedNames.has(candidate.toLowerCase())) {
        candidate = `${basePrefix}${suffix}_(${dup++})${ext}`
      }
      usedNames.add(candidate.toLowerCase())
      zip.addFile(candidate, fs.readFileSync(abs))
      exportedNames.push(candidate)
      fileCount++
    })

    indexLines.push(
      `${numStr}. 【${g.catLabel}】${g.title}${g.subtitle ? ' | ' + g.subtitle : ''}${g.period ? ' (' + g.period + ')' : ''}`
    )
    for (const fn of exportedNames) {
      indexLines.push(`    └─ 文件：${fn}`)
    }
    indexLines.push('')
  })

  if (fileCount === 0) {
    throw new Error('所选条目下没有可导出的证明附件文件')
  }

  if (includeIndex) {
    zip.addFile('00_证明材料目录清单.txt', Buffer.from(indexLines.join('\r\n'), 'utf-8'))
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  zip.writeZip(outPath)
  return { fileCount, entryCount }
}
