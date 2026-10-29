import type {
  BatchFillRequest,
  Database,
  DeAiPatchItem,
  FormFillItem,
  GenerateRequest,
  PolishFieldRequest
} from '@shared/types'
import { entryTitle, formatValue, resolveCategories, visibleFields } from '@shared/categories'
import type { ResolvedModel } from '../settings'
import { chat, chatStream } from './client'
import { parseModelJson } from './extract'
import {
  ANTI_AI_CLICHE_RULES,
  buildBatchFillPrompt,
  buildGeneratePrompt,
  buildPolishFieldPrompt
} from './prompts'

export async function generateStream(
  m: ResolvedModel,
  req: GenerateRequest,
  db: Database,
  onDelta: (t: string) => void,
  signal: AbortSignal
): Promise<void> {
  const messages = buildGeneratePrompt(req, db)
  await chatStream(m, messages, onDelta, { temperature: 0.6, signal })
}

export async function batchFillForm(
  getModel: (w: 'text' | 'vision') => ResolvedModel,
  req: BatchFillRequest,
  db: Database
): Promise<FormFillItem[]> {
  if (!req.fieldsText?.trim() && !req.imageDataUrl) {
    throw new Error('请粘贴表格栏目说明或上传表格截图')
  }
  const model = getModel(req.imageDataUrl ? 'vision' : 'text')
  const messages = buildBatchFillPrompt(req, db)
  const raw = await chat(model, messages, { json: !req.imageDataUrl, temperature: 0.25 })
  const parsed = parseModelJson(raw) as { items?: unknown[] } | unknown[]
  const arr = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { items?: unknown[] }).items)
      ? (parsed as { items: unknown[] }).items
      : []

  const out: FormFillItem[] = []
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const field = String(rec.field ?? rec.label ?? rec.name ?? '').trim()
    if (!field) continue
    const value = rec.value == null ? '' : String(rec.value).trim()
    const note = rec.note ? String(rec.note).trim() : undefined
    out.push({ field, value, note })
  }
  return out
}

export async function polishFieldText(m: ResolvedModel, req: PolishFieldRequest): Promise<string> {
  if (!req.rawText?.trim()) {
    throw new Error('请先输入需要润色的内容草稿')
  }
  const messages = buildPolishFieldPrompt(req)
  const res = await chat(m, messages, { temperature: 0.4 })
  return res.trim().replace(/^["'“”]+|["'“”]+$/g, '').trim()
}

/**
 * 扫描简历中的个人总结与各条目长文本字段，调用 AI 将浓重的“AI 腔 / 假大空套话”改写为真实自然的平实简历表述
 */
export async function deAiResumePreview(
  m: ResolvedModel,
  db: Database,
  entryIds?: string[]
): Promise<DeAiPatchItem[]> {
  const candidates: {
    id: string
    targetType: 'profile' | 'entry'
    entryId?: string
    title: string
    fieldKey: string
    fieldLabel: string
    original: string
  }[] = []

  const summary = formatValue(db.profile?.data?.summary)
  if (summary && summary.length >= 10) {
    candidates.push({
      id: 'profile:summary',
      targetType: 'profile',
      title: '基本信息 - 个人总结',
      fieldKey: 'summary',
      fieldLabel: '个人总结/简介',
      original: summary
    })
  }

  const cats = resolveCategories(db.schema)
  const catMap = new Map(cats.map((c) => [c.id, c]))
  const idSet = entryIds && entryIds.length > 0 ? new Set(entryIds) : null
  const entries = idSet ? db.entries.filter((e) => idSet.has(e.id)) : db.entries

  for (const entry of entries) {
    const cat = catMap.get(entry.category)
    if (!cat || cat.hidden) continue
    const title = `${cat.label} - ${entryTitle(cat, entry.data)}`
    for (const f of visibleFields(cat)) {
      if (f.type !== 'textarea') continue
      const val = formatValue(entry.data[f.key])
      if (val && val.length >= 8) {
        candidates.push({
          id: `${entry.id}:${f.key}`,
          targetType: 'entry',
          entryId: entry.id,
          title,
          fieldKey: f.key,
          fieldLabel: f.label,
          original: val
        })
      }
    }
  }

  if (candidates.length === 0) {
    return []
  }

  const systemPrompt = `你是一位资深真人简历审校编辑。用户的简历中部分段落带有明显的“AI 生成腔调 / 翻译腔 / 互联网假大空黑话”。
请对下列简历段落逐一去 AI 味，改写为**自然、平实、真诚、干练**的真人简历表达。

${ANTI_AI_CLICHE_RULES}

【改写要求】
1. 把浮夸虚词（如“全方位赋能”、“深度参与构建…闭环”、“展现出卓越的…”、“极大地提升了系统鲁棒性”）改写为具体、实在、克制的白话专业表达。
2. 保留原有的真实技术栈、具体工作事项和客观数据，绝不删减真实干货，也绝不编造新事实。
3. 多要点列表继续使用 "• " 换行分点，但每一点直接以具体动词（如“开发”、“实现”、“设计”、“测试”、“搭建”、“整理”）开头，去掉冗余铺垫。
4. 严格输出 JSON 格式：
{
  "patches": [
    {
      "id": "原样返回输入项的 id",
      "revised": "去除 AI 味后的平实文本"
    }
  ]
}`

  const userInput = JSON.stringify(
    candidates.map((c) => ({
      id: c.id,
      title: c.title,
      fieldLabel: c.fieldLabel,
      original: c.original
    })),
    null,
    2
  )

  const raw = await chat(
    m,
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `请对以下简历文本进行去 AI 味平实化改写：\n${userInput}` }
    ],
    { json: true, temperature: 0.3 }
  )

  const parsed = parseModelJson(raw) as { patches?: { id?: string; revised?: string }[] }
  const patchList = Array.isArray(parsed?.patches) ? parsed.patches : []
  const revisedMap = new Map<string, string>()
  for (const p of patchList) {
    if (p && typeof p.id === 'string' && typeof p.revised === 'string' && p.revised.trim()) {
      revisedMap.set(p.id, p.revised.trim())
    }
  }

  const result: DeAiPatchItem[] = []
  for (const c of candidates) {
    const rev = revisedMap.get(c.id)
    if (rev && rev !== c.original) {
      result.push({
        targetType: c.targetType,
        entryId: c.entryId,
        title: c.title,
        fieldKey: c.fieldKey,
        fieldLabel: c.fieldLabel,
        original: c.original,
        revised: rev
      })
    }
  }
  return result
}
