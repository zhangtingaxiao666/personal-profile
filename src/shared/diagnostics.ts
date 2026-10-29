import type { CategoryDef, Database, Entry, FieldConflict } from './types'
import { entryTitle, formatValue, resolveCategories, visibleFields } from './categories'

export interface ConflictWarning {
  id: string
  kind: 'conflict' | 'duplicate' | 'timeline'
  categoryId: string
  categoryLabel: string
  entryIds: string[]
  title: string
  detail: string
  /** 冲突字段信息（用于一键原地消解） */
  conflictFieldKey?: string
  conflictFieldLabel?: string
  existingValue?: string
  incomingValue?: string
  combinedValue?: string
}

/** 归一化标题文本，用于模糊比对 */
export function normalizeTitleForMatch(str: string): string {
  let s = str
    .replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\u3000/g, ' ')
    .toLowerCase()

  // 常见证书别名归一
  if (/cet[-_\s]*6|六级/.test(s)) return 'cet6_大学英语六级'
  if (/cet[-_\s]*4|四级/.test(s)) return 'cet4_大学英语四级'
  if (/ielts|雅思/.test(s)) return 'ielts_雅思'
  if (/toefl|托福/.test(s)) return 'toefl_托福'

  s = s.replace(/[\s\-_—·•()（）【】[\]《》<>.,，。、:：;；/\\]/g, '')
  return s
}

type GradeScale = '4_scale' | '5_scale' | '100_scale' | 'unknown'

function detectGradeScale(raw: string): { scale: GradeScale; scaleLabel: string; num: number | null } {
  const s = raw.trim()
  if (/\/\s*4(\.0+)?|四分制|4分制/i.test(s)) {
    const m = /(\d+(?:\.\d+)?)/.exec(s)
    return { scale: '4_scale', scaleLabel: '四分制', num: m ? parseFloat(m[1]) : null }
  }
  if (/\/\s*5(\.0+)?|五分制|5分制/i.test(s)) {
    const m = /(\d+(?:\.\d+)?)/.exec(s)
    return { scale: '5_scale', scaleLabel: '五分制', num: m ? parseFloat(m[1]) : null }
  }
  if (/\/\s*100|百分制|%|分/.test(s)) {
    const m = /(\d+(?:\.\d+)?)/.exec(s)
    const n = m ? parseFloat(m[1]) : null
    if (n !== null && n > 5) {
      return { scale: '100_scale', scaleLabel: '百分制', num: n }
    }
  }
  const m = /(\d+(?:\.\d+)?)/.exec(s)
  if (!m) return { scale: 'unknown', scaleLabel: '未知分制', num: null }
  const num = parseFloat(m[1])
  if (num > 0 && num <= 4.0) return { scale: '4_scale', scaleLabel: '四分制', num }
  if (num > 4.0 && num <= 5.0) return { scale: '5_scale', scaleLabel: '五分制', num }
  if (num >= 50 && num <= 100) return { scale: '100_scale', scaleLabel: '百分制', num }
  return { scale: 'unknown', scaleLabel: '未知分制', num }
}

/**
 * 针对成绩/GPA/排名冲突，智能诊断是「计算方式不同（分制/加权）」还是「不同学期/阶段更新」
 */
export function analyzeGradeConflict(
  fieldKey: string,
  fieldLabel: string,
  existingVal: string,
  incomingVal: string
): { hint: string; combinedValue: string } {
  if (fieldKey === 'gpa' || /gpa|绩点|成绩|均分/i.test(fieldLabel)) {
    const g1 = detectGradeScale(existingVal)
    const g2 = detectGradeScale(incomingVal)

    if (g1.scale !== 'unknown' && g2.scale !== 'unknown' && g1.scale !== g2.scale) {
      return {
        hint: `检测到成绩计算方式/分制不同：已有记录为${g1.scaleLabel}（${existingVal}），新记录为${g2.scaleLabel}（${incomingVal}）。建议采用「双值并存标注」同时保留两种分制，方便不同表格按需选用。`,
        combinedValue: `${existingVal}（${g2.scaleLabel}：${incomingVal}）`
      }
    }
    return {
      hint: `检测到同分制下成绩数值不同（已有「${existingVal}」vs 新值「${incomingVal}」）：可能源于①不同学期/阶段的成绩单更新，或②加权学分绩与算术平均绩点算法不同。若是最新学期总成绩建议「采用新值」；若是不同算法建议「双值并存标注」；若是不同阶段可「作为新条目」。`,
      combinedValue: `${incomingVal}（另：${existingVal}）`
    }
  }

  if (fieldKey === 'rank' || /排名/i.test(fieldLabel)) {
    return {
      hint: `检测到专业/综合排名不一致（已有「${existingVal}」vs 新值「${incomingVal}」）：可能是①不同学期阶段的排名变化，或②纯学业成绩排名与综合测评排名计算口径不同。`,
      combinedValue: `${incomingVal}（原/综测：${existingVal}）`
    }
  }

  if (fieldKey === 'score' || /分数|成绩|等级/i.test(fieldLabel)) {
    return {
      hint: `检测到证书/考试成绩不同（已有「${existingVal}」vs 新值「${incomingVal}」）：可能是多次参加考试刷分或不同科目成绩。建议保留最高分或拆分为两条独立记录。`,
      combinedValue: `${incomingVal}（历次：${existingVal}）`
    }
  }

  if (fieldKey === 'level' || /级别|名次|等级/i.test(fieldLabel)) {
    return {
      hint: `检测到同一奖项的级别/名次不同（已有「${existingVal}」vs 新值「${incomingVal}」）：可能是同一赛事在不同阶段（如校赛/省赛/国赛）的获奖记录，建议作为两条独立奖项入库或合并注明。`,
      combinedValue: `${incomingVal} / ${existingVal}`
    }
  }

  if (fieldKey === 'start' || fieldKey === 'end' || fieldKey === 'date') {
    return {
      hint: `检测到时间字段不一致（已有「${existingVal}」vs 新值「${incomingVal}」）：请确认是否为经历结束时间更新或不同阶段。`,
      combinedValue: incomingVal
    }
  }

  return {
    hint: `字段「${fieldLabel}」与已有记录存在差异（已有「${existingVal}」vs 新值「${incomingVal}」），请核对。`,
    combinedValue: `${incomingVal} / ${existingVal}`
  }
}

/**
 * 在已有条目中查找与候选条目同属一事物的疑似重复项
 * - 教育经历额外比对学历（本科与硕士同一学校不算重复）
 */
export function findDuplicateEntry(
  candidate: { category: string; data: Record<string, unknown> },
  db: Database
): Entry | undefined {
  const categories = resolveCategories(db.schema)
  const catDef = categories.find((c) => c.id === candidate.category)
  if (!catDef) return undefined

  const titleField = catDef.titleField
  const candTitleRaw = formatValue(candidate.data[titleField])
  if (!candTitleRaw) return undefined
  const candNorm = normalizeTitleForMatch(candTitleRaw)
  if (!candNorm) return undefined

  const sameCatEntries = db.entries.filter((e) => e.category === candidate.category)
  for (const entry of sameCatEntries) {
    const existingRaw = formatValue(entry.data[titleField])
    if (!existingRaw) continue
    const existNorm = normalizeTitleForMatch(existingRaw)
    if (!existNorm) continue

    // 教育经历若学历明确且不同（如本科 vs 硕士），视为不同阶段而非重复
    if (candidate.category === 'education') {
      const d1 = formatValue(candidate.data.degree)
      const d2 = formatValue(entry.data.degree)
      if (d1 && d2 && d1 !== d2) continue
    }

    if (candNorm === existNorm) {
      return entry
    }
    if (candNorm.length >= 4 && existNorm.length >= 4) {
      if (candNorm.includes(existNorm) || existNorm.includes(candNorm)) {
        return entry
      }
    }
  }
  return undefined
}

/**
 * 对比候选条目与匹配到的已有条目，提取所有字段级冲突
 */
export function detectEntryConflicts(
  candidate: { category: string; data: Record<string, unknown> },
  existing: Entry,
  catDef: CategoryDef
): FieldConflict[] {
  const conflicts: FieldConflict[] = []
  const fields = visibleFields(catDef)

  for (const f of fields) {
    if (f.key === catDef.titleField) continue
    const vExist = formatValue(existing.data[f.key])
    const vCand = formatValue(candidate.data[f.key])
    if (!vExist || !vCand) continue

    const normExist = vExist.replace(/\s+/g, '').toLowerCase()
    const normCand = vCand.replace(/\s+/g, '').toLowerCase()
    if (normExist === normCand) continue

    // 长文本若互相包含且差异极小则不作为硬冲突，但仍可提示
    const { hint, combinedValue } = analyzeGradeConflict(f.key, f.label, vExist, vCand)
    conflicts.push({
      fieldKey: f.key,
      fieldLabel: f.label,
      existingValue: vExist,
      incomingValue: vCand,
      hint,
      combinedValue
    })
  }
  return conflicts
}

/**
 * 扫描整个资料库中已存在的重复条目、成绩/分制冲突、多学期冲突与时间线逻辑冲突
 */
export function scanDatabaseConflicts(db: Database): ConflictWarning[] {
  const warnings: ConflictWarning[] = []
  const cats = resolveCategories(db.schema).filter((c) => !c.hidden)

  for (const cat of cats) {
    const list = db.entries.filter((e) => e.category === cat.id).sort((a, b) => a.order - b.order)

    // 1. 单条目内部时间冲突检查
    for (const e of list) {
      const s = formatValue(e.data.start)
      const end = formatValue(e.data.end)
      if (/^\d{4}-\d{2}$/.test(s) && /^\d{4}-\d{2}$/.test(end) && s > end) {
        warnings.push({
          id: `time_${e.id}`,
          kind: 'timeline',
          categoryId: cat.id,
          categoryLabel: cat.label,
          entryIds: [e.id],
          title: `${cat.label}「${entryTitle(cat, e.data)}」起止时间倒置`,
          detail: `开始时间（${s}）晚于结束时间（${end}），请核对修改。`
        })
      }
    }

    // 2. 同分类内两两比对重复与字段冲突（尤其是成绩/GPA/排名/证书分数/奖项级别）
    const visitedPairs = new Set<string>()
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i]
        const b = list[j]
        const tA = normalizeTitleForMatch(formatValue(a.data[cat.titleField]))
        const tB = normalizeTitleForMatch(formatValue(b.data[cat.titleField]))
        if (!tA || !tB) continue

        const isTitleMatch =
          tA === tB || (tA.length >= 4 && tB.length >= 4 && (tA.includes(tB) || tB.includes(tA)))
        if (!isTitleMatch) continue

        if (cat.id === 'education') {
          const degA = formatValue(a.data.degree)
          const degB = formatValue(b.data.degree)
          if (degA && degB && degA !== degB) continue
        }

        const pairKey = [a.id, b.id].sort().join('_')
        if (visitedPairs.has(pairKey)) continue
        visitedPairs.add(pairKey)

        const conflicts = detectEntryConflicts({ category: cat.id, data: b.data }, a, cat)
        const gpaOrRankConflict = conflicts.find((c) =>
          ['gpa', 'rank', 'score', 'level'].includes(c.fieldKey)
        )

        if (gpaOrRankConflict) {
          warnings.push({
            id: `conf_${pairKey}`,
            kind: 'conflict',
            categoryId: cat.id,
            categoryLabel: cat.label,
            entryIds: [a.id, b.id],
            title: `${cat.label}「${entryTitle(cat, a.data)}」存在冲突的${gpaOrRankConflict.fieldLabel}记录`,
            detail: gpaOrRankConflict.hint,
            conflictFieldKey: gpaOrRankConflict.fieldKey,
            conflictFieldLabel: gpaOrRankConflict.fieldLabel,
            existingValue: gpaOrRankConflict.existingValue,
            incomingValue: gpaOrRankConflict.incomingValue,
            combinedValue: gpaOrRankConflict.combinedValue
          })
        } else if (conflicts.length > 0) {
          const firstConf = conflicts[0]
          const labels = conflicts.map((c) => `${c.fieldLabel}（${c.existingValue} vs ${c.incomingValue}）`).join('；')
          warnings.push({
            id: `conf_${pairKey}`,
            kind: 'conflict',
            categoryId: cat.id,
            categoryLabel: cat.label,
            entryIds: [a.id, b.id],
            title: `${cat.label}「${entryTitle(cat, a.data)}」存在 2 条内容冲突记录`,
            detail: `冲突字段：${labels}。请确认是否为不同阶段记录或将其合并。`,
            conflictFieldKey: firstConf.fieldKey,
            conflictFieldLabel: firstConf.fieldLabel,
            existingValue: firstConf.existingValue,
            incomingValue: firstConf.incomingValue,
            combinedValue: firstConf.combinedValue
          })
        } else {
          warnings.push({
            id: `dup_${pairKey}`,
            kind: 'duplicate',
            categoryId: cat.id,
            categoryLabel: cat.label,
            entryIds: [a.id, b.id],
            title: `${cat.label}中存在疑似重复条目「${entryTitle(cat, a.data)}」`,
            detail: `共有 2 条同名记录，建议核对后删除多余条目或合并其证明附件。`
          })
        }
      }
    }
  }

  return warnings
}
