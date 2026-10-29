import path from 'path'
import { randomUUID } from 'crypto'
import { z } from 'zod'
import type { CandidateEntry, Database, ExtractInput, ExtractResult, FieldDef } from '@shared/types'
import { resolveCategories, resolveProfileCategory } from '@shared/categories'
import { detectEntryConflicts, findDuplicateEntry, scanDatabaseConflicts } from '@shared/diagnostics'
import type { ResolvedModel } from '../settings'
import { chat, type ChatMessage, type ChatMessageContentPart } from './client'
import { buildExtractionSystemPrompt, buildOrganizePrompt } from './prompts'

export function parseModelJson(raw: string): unknown {
  if (!raw || typeof raw !== 'string') {
    throw new Error('模型返回内容为空')
  }

  const firstBrace = raw.indexOf('{')
  const lastBrace = raw.lastIndexOf('}')
  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    throw new Error('未找到有效的 JSON 内容')
  }

  let jsonStr = raw.slice(firstBrace, lastBrace + 1)
  // 去除尾随逗号（在 } 或 ] 前面的一个或多个逗号）
  jsonStr = jsonStr.replace(/,+(\s*[}\]])/g, '$1')

  return JSON.parse(jsonStr)
}

function normalizeTags(v: unknown): string[] {
  if (v == null) return []
  if (Array.isArray(v)) {
    return v
      .map((x) => (typeof x === 'string' ? x.trim() : String(x).trim()))
      .filter((x) => x !== '')
  }
  if (typeof v === 'string') {
    return v
      .split(/[,，、;；]/)
      .map((s) => s.trim())
      .filter(Boolean)
  }
  return []
}

function normalizeMonth(v: unknown): string | undefined {
  if (v == null) return undefined
  const str = String(v).trim()
  if (!str) return undefined
  if (/^(至今|现在|present|current)$/i.test(str)) {
    return '至今'
  }
  const clean = str.replace(/\s+/g, '')
  const m = clean.match(/^(\d{4})[./\-\\年](\d{1,2})月?$/)
  if (m) {
    const y = m[1]
    const mo = m[2].padStart(2, '0')
    return `${y}-${mo}`
  }
  return str
}

function normalizeDate(v: unknown): string | undefined {
  if (v == null) return undefined
  const str = String(v).trim()
  if (!str) return undefined
  const clean = str.replace(/\s+/g, '')
  const m = clean.match(/^(\d{4})[./\-\\年](\d{1,2})[./\-\\月](\d{1,2})[日号]?$/)
  if (m) {
    const y = m[1]
    const mo = m[2].padStart(2, '0')
    const d = m[3].padStart(2, '0')
    return `${y}-${mo}-${d}`
  }
  return str
}

function cleanFieldValue(f: FieldDef, rawVal: unknown): unknown {
  if (rawVal == null) return undefined

  if (f.type === 'tags') {
    const tags = normalizeTags(rawVal)
    return tags.length > 0 ? tags : undefined
  }

  if (f.type === 'month') {
    const m = normalizeMonth(rawVal)
    return m ? m : undefined
  }

  if (f.type === 'date') {
    const d = normalizeDate(rawVal)
    return d ? d : undefined
  }

  if (typeof rawVal === 'number' || typeof rawVal === 'boolean') {
    return String(rawVal)
  }

  if (typeof rawVal === 'string') {
    const trimmed = rawVal.trim()
    return trimmed.length > 0 ? trimmed : undefined
  }

  if (Array.isArray(rawVal)) {
    const arr = rawVal.map((x) => String(x).trim()).filter(Boolean)
    return arr.length > 0 ? arr.join('、') : undefined
  }

  return undefined
}

export function normalizeTitle(s: unknown): string {
  if (s == null) return ''
  return String(s)
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
    .replace(/\s+/g, '')
    .toLowerCase()
}

export function findDuplicate(
  c: { category: string; data: Record<string, unknown> },
  db: Database
): string | undefined {
  return findDuplicateEntry(c, db)?.id
}

const RawEntrySchema = z
  .object({
    category: z.unknown().optional(),
    data: z.record(z.string(), z.unknown()).optional().nullable(),
    tags: z.unknown().optional()
  })
  .passthrough()

const RawModelOutputSchema = z
  .object({
    profile: z.record(z.string(), z.unknown()).optional().nullable(),
    entries: z.array(RawEntrySchema).optional().nullable(),
    warnings: z.array(z.unknown()).optional().nullable()
  })
  .passthrough()

export function normalizeResult(
  raw: unknown,
  db: Database
): {
  candidates: Omit<CandidateEntry, 'tempId' | 'sourceFiles'>[]
  profilePatch: Record<string, unknown>
  warnings: string[]
} {
  const warnings: string[] = []

  const parsed = RawModelOutputSchema.safeParse(raw)
  const data = parsed.success ? parsed.data : {}

  // 1. profile 规范化（只保留 profile 字段且排除 sensitive）
  const profilePatch: Record<string, unknown> = {}
  const profileCat = resolveProfileCategory(db.schema)
  const profileFieldMap = new Map(profileCat.fields.map((f) => [f.key, f]))
  const rawProfile = (data.profile && typeof data.profile === 'object') ? data.profile : {}

  for (const [k, v] of Object.entries(rawProfile)) {
    const f = profileFieldMap.get(k)
    if (!f || f.sensitive) continue
    const cleaned = cleanFieldValue(f, v)
    if (cleaned !== undefined) {
      profilePatch[k] = cleaned
    }
  }

  // 2. entries 规范化
  const candidates: Omit<CandidateEntry, 'tempId' | 'sourceFiles'>[] = []
  const categories = resolveCategories(db.schema)
  const catMap = new Map(categories.map((c) => [c.id, c]))

  const rawEntries = Array.isArray(data.entries) ? data.entries : []
  for (const item of rawEntries) {
    const catId = typeof item.category === 'string' ? item.category.trim() : ''
    if (!catId || !catMap.has(catId)) {
      warnings.push(`丢弃未知分类条目："${catId || '未指定'}"`)
      continue
    }

    const def = catMap.get(catId)!
    const fieldMap = new Map(def.fields.map((f) => [f.key, f]))
    const cleanedData: Record<string, unknown> = {}
    const rawData = item.data && typeof item.data === 'object' ? item.data : {}

    for (const [k, v] of Object.entries(rawData)) {
      const f = fieldMap.get(k)
      if (!f) continue // 只保留该分类存在的字段 key
      const cleaned = cleanFieldValue(f, v)
      if (cleaned !== undefined) {
        cleanedData[k] = cleaned
      }
    }

    if (Object.keys(cleanedData).length === 0) {
      // data 为空的条目丢弃
      continue
    }

    const cand: Omit<CandidateEntry, 'tempId' | 'sourceFiles'> = {
      category: catId,
      data: cleanedData,
      tags: normalizeTags(item.tags)
    }

    const dupEntry = findDuplicateEntry(cand, db)
    if (dupEntry) {
      cand.duplicateOf = dupEntry.id
      const conflicts = detectEntryConflicts(cand, dupEntry, def)
      if (conflicts.length > 0) {
        cand.conflicts = conflicts
        for (const c of conflicts) {
          warnings.push(`【${def.label}冲突】${c.hint}`)
        }
      }
    }

    candidates.push(cand)
  }

  // 3. warnings 收集
  if (Array.isArray(data.warnings)) {
    for (const w of data.warnings) {
      if (typeof w === 'string' && w.trim()) {
        warnings.push(w.trim())
      }
    }
  }

  return {
    candidates,
    profilePatch,
    warnings
  }
}

export async function extractFromInputs(
  getModel: (w: 'text' | 'vision') => ResolvedModel,
  inputs: ExtractInput[],
  db: Database
): Promise<ExtractResult> {
  const allCandidates: CandidateEntry[] = []
  const mergedProfilePatch: Record<string, unknown> = {}
  const allWarnings: string[] = []

  if (!inputs || inputs.length === 0) {
    return { candidates: [], profilePatch: {}, warnings: [] }
  }

  let successCount = 0
  let firstError: Error | null = null
  const systemPrompt = buildExtractionSystemPrompt(db)

  for (const input of inputs) {
    const fileName =
      input.fileName ||
      (input.filePath ? path.basename(input.filePath) : '输入材料')

    try {
      const hasImages = Array.isArray(input.images) && input.images.length > 0
      const model = getModel(hasImages ? 'vision' : 'text')

      let text = input.text ?? ''
      if (text.length > 30000) {
        text = text.slice(0, 30000)
      }

      let userContent: string | ChatMessageContentPart[]
      if (hasImages) {
        const parts: ChatMessageContentPart[] = []
        if (text.trim()) {
          parts.push({
            type: 'text',
            text: `待提取材料（文件名：${fileName}）的文本内容：\n\n${text}`
          })
        } else {
          parts.push({
            type: 'text',
            text: `请从以下图片中提取个人信息与经历条目（文件名：${fileName}）：`
          })
        }
        for (const imgUrl of input.images!) {
          parts.push({
            type: 'image_url',
            image_url: { url: imgUrl }
          })
        }
        userContent = parts
      } else {
        userContent = `待提取材料（文件名：${fileName}）：\n\n${text}`
      }

      const messages: ChatMessage[] = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userContent }
      ]

      const responseText = await chat(model, messages, { json: true })
      const rawJson = parseModelJson(responseText)
      const norm = normalizeResult(rawJson, db)

      for (const cand of norm.candidates) {
        allCandidates.push({
          ...cand,
          tempId: randomUUID(),
          sourceFiles: input.filePath ? [input.filePath] : []
        })
      }

      for (const [k, v] of Object.entries(norm.profilePatch)) {
        if (!(k in mergedProfilePatch)) {
          mergedProfilePatch[k] = v
        }
      }

      for (const w of norm.warnings) {
        allWarnings.push(`${fileName}：${w}`)
      }

      successCount++
    } catch (err) {
      if (!firstError) {
        firstError = err as Error
      }
      allWarnings.push(`${fileName}：${(err as Error).message}`)
    }
  }

  if (inputs.length > 0 && successCount === 0 && firstError) {
    throw firstError
  }

  // 检查本次批次内多个候选条目之间的互相冲突/重复
  if (allCandidates.length > 1) {
    const tempDb: Database = {
      ...db,
      entries: allCandidates.map((c, idx) => ({
        id: c.tempId,
        category: c.category,
        data: c.data,
        tags: c.tags,
        attachments: [],
        source: 'ai',
        order: idx,
        createdAt: '',
        updatedAt: ''
      }))
    }
    for (const cw of scanDatabaseConflicts(tempDb)) {
      allWarnings.push(`【本次导入内部${cw.kind === 'conflict' ? '冲突' : '重复'}】${cw.title}：${cw.detail}`)
    }
  }

  return {
    candidates: allCandidates,
    profilePatch: mergedProfilePatch,
    warnings: allWarnings
  }
}

export async function organizeText(
  m: ResolvedModel,
  text: string,
  categoryHint: string | undefined,
  db: Database
): Promise<ExtractResult> {
  let truncatedText = text ?? ''
  if (truncatedText.length > 30000) {
    truncatedText = truncatedText.slice(0, 30000)
  }

  const systemPrompt = buildOrganizePrompt(categoryHint, db)
  const userContent = categoryHint
    ? `请将以下口述经历整理为规范条目（优先归入分类 "${categoryHint}"）：\n\n${truncatedText}`
    : `请将以下口述经历整理为规范条目：\n\n${truncatedText}`

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent }
  ]

  const responseText = await chat(m, messages, { json: true })
  const rawJson = parseModelJson(responseText)
  const norm = normalizeResult(rawJson, db)

  const candidates: CandidateEntry[] = norm.candidates.map((cand) => ({
    ...cand,
    tempId: randomUUID(),
    sourceFiles: []
  }))

  return {
    candidates,
    profilePatch: norm.profilePatch,
    warnings: norm.warnings
  }
}
