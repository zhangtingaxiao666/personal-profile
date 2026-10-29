import type { Database, ExportResumeOptions, ResumeDensity, ResumeTheme } from '@shared/types'
import {
  resolveCategories,
  resolveProfileCategory,
  visibleFields,
  formatValue,
  periodText,
  entryTitle
} from '@shared/categories'

export interface ResumeLine {
  label?: string
  text: string
  bullet?: boolean
}

export interface ResumeItem {
  title: string
  subtitle: string
  period: string
  lines: ResumeLine[]
  tags: string[]
  /** 单行紧凑模式（用于无长文本描述的获奖荣誉、证书资质等，使标题、副标题、时间同行排布） */
  compactInline?: boolean
}

export interface ResumeModel {
  name: string
  title?: string
  theme: ResumeTheme
  density: ResumeDensity
  contacts: string[]
  infoPairs: { label: string; value: string }[]
  summary?: string
  photoAbsPath?: string
  sections: {
    id: string
    label: string
    items: ResumeItem[]
  }[]
}

const CONTACT_KEYS = new Set(['phone', 'email', 'wechat', 'website', 'jobIntention'])
const EXCLUDE_FROM_INFO_PAIRS = new Set(['name', 'summary', 'hobbies', ...CONTACT_KEYS])

/** 不打印生硬字段名标签、直接作为自然要点呈现的叙事型字段 key */
const NARRATIVE_FIELD_KEYS = new Set([
  'background',
  'responsibilities',
  'achievements',
  'description',
  'abstract'
])

/** 将叙事段落拆分为干净的要点行，去除多余的 AI 列表符号重复 */
function normalizeNarrativeLines(rawText: string): ResumeLine[] {
  const rawLines = rawText
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)

  return rawLines.map((line) => {
    const cleaned = line.replace(/^[•·\-*]+\s*/, '').trim()
    return {
      text: `• ${cleaned}`,
      bullet: true
    }
  })
}

export function buildResumeModel(
  db: Database,
  opts: ExportResumeOptions,
  absOf: (rel: string) => string
): ResumeModel {
  const profileCat = resolveProfileCategory(db.schema ?? { categories: {}, customCategories: [] })
  const profileFields = visibleFields(profileCat)
  const profileData = db.profile?.data ?? {}

  const name = formatValue(profileData.name) || '未命名'
  const title = opts.title?.trim() || undefined
  const theme: ResumeTheme = opts.theme ?? 'classic'
  const density: ResumeDensity = opts.density ?? 'normal'
  const summary =
    typeof profileData.summary === 'string' && profileData.summary.trim()
      ? profileData.summary.trim()
      : undefined

  const photoAbsPath =
    opts.includePhoto && db.profile?.avatarRelPath ? absOf(db.profile.avatarRelPath) : undefined

  const contacts: string[] = []
  const infoPairs: { label: string; value: string }[] = []

  for (const field of profileFields) {
    if (field.sensitive) continue
    const rawVal = profileData[field.key]
    const val = formatValue(rawVal)
    if (!val) continue

    if (CONTACT_KEYS.has(field.key)) {
      contacts.push(val)
    } else if (!EXCLUDE_FROM_INFO_PAIRS.has(field.key)) {
      infoPairs.push({ label: field.label, value: val })
    }
  }

  const allCategories = resolveCategories(db.schema ?? { categories: {}, customCategories: [] })
  const catById = new Map(allCategories.map((c) => [c.id, c]))
  // 严格按照 opts.categories 传入的模块顺序排布简历章节（支持用户自由上下移动大类顺序）
  const orderedCategories = Array.isArray(opts.categories)
    ? opts.categories
        .map((id) => catById.get(id))
        .filter((c): c is NonNullable<typeof c> => Boolean(c && !c.hidden))
    : allCategories.filter((c) => !c.hidden)
  const requestedEntryIds = opts.entryIds ? new Set(opts.entryIds) : null

  const sections: ResumeModel['sections'] = []

  for (const cat of orderedCategories) {

    let catEntries = (db.entries ?? []).filter((e) => e.category === cat.id)
    if (requestedEntryIds) {
      catEntries = catEntries.filter((e) => requestedEntryIds.has(e.id))
    }

    catEntries.sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

    if (catEntries.length === 0) continue

    // 技能分类特殊处理：合并为紧凑分类行
    if (cat.id === 'skill') {
      const groups = new Map<string, string[]>()
      for (const e of catEntries) {
        const skillName = formatValue(e.data.name)
        if (!skillName) continue
        const level = formatValue(e.data.level)
        const skillStr = level ? `${skillName}（${level}）` : skillName
        const skillCat = formatValue(e.data.category) || ''
        if (!groups.has(skillCat)) groups.set(skillCat, [])
        groups.get(skillCat)!.push(skillStr)
      }

      const lines: ResumeLine[] = []
      for (const [skillCat, skillList] of groups.entries()) {
        if (skillCat) {
          lines.push({ label: skillCat, text: skillList.join('、') })
        } else {
          lines.push({ text: skillList.join('、') })
        }
      }

      if (lines.length > 0) {
        sections.push({
          id: cat.id,
          label: cat.label,
          items: [
            {
              title: '',
              subtitle: '',
              period: '',
              lines,
              tags: []
            }
          ]
        })
      }
      continue
    }

    const items: ResumeItem[] = []
    const catFields = visibleFields(cat)
    const skipFieldKeys = new Set([
      cat.titleField,
      ...(cat.subtitleFields ?? []),
      'start',
      'end',
      'date'
    ])

    for (const entry of catEntries) {
      const entryTitleText = entryTitle(cat, entry.data)
      const subtitleParts = (cat.subtitleFields ?? [])
        .map((k) => formatValue(entry.data[k]))
        .filter(Boolean)

      // 项目经验中将技术栈自然并入副标题，避免单独占一行「技术/工具：」显得生硬
      if (cat.id === 'project') {
        const tech = formatValue(entry.data.techStack)
        if (tech) {
          subtitleParts.push(tech)
          skipFieldKeys.add('techStack')
        }
      }

      const subtitle = subtitleParts.join('  ·  ')
      const period = periodText(entry.data)
      const lines: ResumeLine[] = []

      // 教育经历：将 GPA 与排名合并为单行紧凑展示
      if (cat.id === 'education') {
        const gpa = formatValue(entry.data.gpa)
        const rank = formatValue(entry.data.rank)
        const metrics: string[] = []
        if (gpa) metrics.push(`成绩/GPA：${gpa}`)
        if (rank) metrics.push(`专业排名：${rank}`)
        if (metrics.length > 0) {
          lines.push({ text: metrics.join('    |    ') })
        }
        skipFieldKeys.add('gpa')
        skipFieldKeys.add('rank')
      }

      for (const field of catFields) {
        if (skipFieldKeys.has(field.key) || field.sensitive) continue
        const val = formatValue(entry.data[field.key])
        if (!val) continue

        if (NARRATIVE_FIELD_KEYS.has(field.key)) {
          lines.push(...normalizeNarrativeLines(val))
        } else {
          lines.push({ label: field.label, text: val })
        }
      }

      const isCompact =
        (cat.id === 'award' || cat.id === 'certificate') && lines.length === 0

      items.push({
        title: entryTitleText,
        subtitle,
        period,
        lines,
        tags: Array.isArray(entry.tags) ? entry.tags.filter(Boolean) : [],
        compactInline: isCompact
      })
    }

    if (items.length > 0) {
      sections.push({
        id: cat.id,
        label: cat.label,
        items
      })
    }
  }

  return {
    name,
    title,
    theme,
    density,
    contacts,
    infoPairs,
    summary,
    photoAbsPath,
    sections
  }
}
