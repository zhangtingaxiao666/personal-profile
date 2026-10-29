import type { CategoryDef, FieldDef, SchemaOverrides } from './types'

/** 基本信息字段（单例），在字段管理中以 id = 'profile' 出现 */
export const PROFILE_CATEGORY: CategoryDef = {
  id: 'profile',
  label: '基本信息',
  icon: 'UserOutlined',
  titleField: 'name',
  fields: [
    { key: 'name', label: '姓名', type: 'text', required: true },
    { key: 'gender', label: '性别', type: 'select', options: ['男', '女'] },
    { key: 'birth', label: '出生日期', type: 'date' },
    { key: 'phone', label: '手机号', type: 'text' },
    { key: 'email', label: '邮箱', type: 'text' },
    { key: 'wechat', label: '微信', type: 'text' },
    { key: 'hometown', label: '籍贯', type: 'text' },
    { key: 'ethnicity', label: '民族', type: 'text' },
    {
      key: 'politicalStatus',
      label: '政治面貌',
      type: 'select',
      options: ['中共党员', '中共预备党员', '共青团员', '群众', '其他']
    },
    { key: 'idNumber', label: '身份证号', type: 'text', sensitive: true },
    { key: 'address', label: '现居地址', type: 'text' },
    { key: 'currentSchoolOrCompany', label: '当前学校/单位', type: 'text' },
    { key: 'jobIntention', label: '求职意向', type: 'text' },
    { key: 'website', label: '个人主页/GitHub', type: 'url' },
    { key: 'hobbies', label: '兴趣爱好', type: 'tags' },
    { key: 'summary', label: '个人简介', type: 'textarea' }
  ]
}

export const BUILTIN_CATEGORIES: CategoryDef[] = [
  {
    id: 'education',
    label: '教育经历',
    icon: 'ReadOutlined',
    titleField: 'school',
    subtitleFields: ['degree', 'major'],
    aiHint: '学校教育经历（本科、硕士等）',
    fields: [
      { key: 'school', label: '学校', type: 'text', required: true },
      { key: 'degree', label: '学历', type: 'select', options: ['高中', '专科', '本科', '硕士', '博士', '其他'] },
      { key: 'major', label: '专业', type: 'text' },
      { key: 'college', label: '学院', type: 'text' },
      { key: 'start', label: '开始时间', type: 'month' },
      { key: 'end', label: '结束时间', type: 'month' },
      { key: 'gpa', label: 'GPA/成绩', type: 'text' },
      { key: 'rank', label: '专业排名', type: 'text' },
      { key: 'courses', label: '主修课程', type: 'tags' },
      { key: 'description', label: '补充说明', type: 'textarea' }
    ]
  },
  {
    id: 'work',
    label: '实习/工作',
    icon: 'BankOutlined',
    titleField: 'company',
    subtitleFields: ['position'],
    aiHint: '实习或正式工作经历',
    fields: [
      { key: 'company', label: '公司/单位', type: 'text', required: true },
      { key: 'position', label: '职位', type: 'text' },
      { key: 'department', label: '部门', type: 'text' },
      { key: 'type', label: '类型', type: 'select', options: ['实习', '全职', '兼职'] },
      { key: 'start', label: '开始时间', type: 'month' },
      { key: 'end', label: '结束时间', type: 'month' },
      { key: 'responsibilities', label: '工作内容', type: 'textarea' },
      { key: 'achievements', label: '工作成果', type: 'textarea' }
    ]
  },
  {
    id: 'project',
    label: '项目经验',
    icon: 'ProjectOutlined',
    titleField: 'name',
    subtitleFields: ['role'],
    aiHint: '参与或负责的项目（课程项目、科研项目、竞赛项目、个人项目等）',
    fields: [
      { key: 'name', label: '项目名称', type: 'text', required: true },
      { key: 'role', label: '担任角色', type: 'text' },
      { key: 'start', label: '开始时间', type: 'month' },
      { key: 'end', label: '结束时间', type: 'month' },
      { key: 'techStack', label: '技术/工具', type: 'tags' },
      { key: 'background', label: '项目背景', type: 'textarea' },
      { key: 'responsibilities', label: '主要职责', type: 'textarea' },
      { key: 'achievements', label: '成果/量化指标', type: 'textarea' },
      { key: 'link', label: '链接', type: 'url' }
    ]
  },
  {
    id: 'award',
    label: '获奖荣誉',
    icon: 'TrophyOutlined',
    titleField: 'name',
    subtitleFields: ['level', 'rank'],
    aiHint: '竞赛获奖、奖学金、荣誉称号',
    fields: [
      { key: 'name', label: '奖项名称', type: 'text', required: true },
      { key: 'level', label: '级别', type: 'select', options: ['国际级', '国家级', '省部级', '市级', '校级', '院级', '其他'] },
      { key: 'rank', label: '名次/等级', type: 'text', placeholder: '如：一等奖、金奖、第 3 名' },
      { key: 'issuer', label: '颁发单位', type: 'text' },
      { key: 'date', label: '获奖时间', type: 'month' },
      { key: 'description', label: '说明', type: 'textarea' }
    ]
  },
  {
    id: 'certificate',
    label: '证书资质',
    icon: 'SafetyCertificateOutlined',
    titleField: 'name',
    subtitleFields: ['score'],
    aiHint: '证书、资格认证、语言考试成绩（如 CET-6、计算机等级、教师资格证）',
    fields: [
      { key: 'name', label: '证书名称', type: 'text', required: true },
      { key: 'score', label: '成绩/等级', type: 'text' },
      { key: 'number', label: '证书编号', type: 'text' },
      { key: 'issuer', label: '发证机构', type: 'text' },
      { key: 'date', label: '获得时间', type: 'month' },
      { key: 'expire', label: '有效期至', type: 'month' }
    ]
  },
  {
    id: 'skill',
    label: '技能特长',
    icon: 'ToolOutlined',
    titleField: 'name',
    subtitleFields: ['level'],
    aiHint: '专业技能、语言能力、软件工具等',
    fields: [
      { key: 'name', label: '技能名称', type: 'text', required: true },
      { key: 'category', label: '类别', type: 'select', options: ['专业技能', '编程语言', '软件工具', '语言能力', '软技能', '其他'] },
      { key: 'level', label: '熟练度', type: 'select', options: ['了解', '熟悉', '熟练', '精通'] },
      { key: 'description', label: '说明', type: 'textarea' }
    ]
  },
  {
    id: 'activity',
    label: '校园/社会实践',
    icon: 'TeamOutlined',
    titleField: 'name',
    subtitleFields: ['role'],
    aiHint: '学生工作、社团、志愿服务、社会实践',
    fields: [
      { key: 'name', label: '组织/活动名称', type: 'text', required: true },
      { key: 'role', label: '职务/角色', type: 'text' },
      { key: 'start', label: '开始时间', type: 'month' },
      { key: 'end', label: '结束时间', type: 'month' },
      { key: 'description', label: '经历描述', type: 'textarea' }
    ]
  },
  {
    id: 'publication',
    label: '论文/专利/作品',
    icon: 'FileTextOutlined',
    titleField: 'title',
    subtitleFields: ['type', 'venue'],
    aiHint: '发表的论文、专利、软著、作品',
    fields: [
      { key: 'title', label: '标题', type: 'text', required: true },
      { key: 'type', label: '类型', type: 'select', options: ['论文', '专利', '软件著作权', '作品', '其他'] },
      { key: 'authors', label: '作者/排序', type: 'text' },
      { key: 'venue', label: '期刊/会议/授权号', type: 'text' },
      { key: 'date', label: '时间', type: 'month' },
      { key: 'link', label: '链接', type: 'url' },
      { key: 'description', label: '简介', type: 'textarea' }
    ]
  }
]

export function emptyOverrides(): SchemaOverrides {
  return { categories: {}, customCategories: [] }
}

function applyOverride(def: CategoryDef, ov: SchemaOverrides): CategoryDef {
  const o = ov.categories[def.id]
  if (!o) return { ...def, fields: def.fields.map((f) => ({ ...f })) }
  let fields: FieldDef[] = def.fields.map((f) => ({ ...f, ...(o.fieldPatches?.[f.key] ?? {}) }))
  for (const ef of o.extraFields ?? []) {
    if (!fields.some((f) => f.key === ef.key)) fields.push({ ...ef, custom: true, ...(o.fieldPatches?.[ef.key] ?? {}) })
  }
  if (o.fieldOrder?.length) {
    const idx = (k: string) => {
      const i = o.fieldOrder!.indexOf(k)
      return i === -1 ? Number.MAX_SAFE_INTEGER : i
    }
    fields = fields
      .map((f, i) => ({ f, i }))
      .sort((a, b) => idx(a.f.key) - idx(b.f.key) || a.i - b.i)
      .map((x) => x.f)
  }
  return {
    ...def,
    label: o.label ?? def.label,
    hidden: o.hidden ?? def.hidden,
    fields
  }
}

/** 合并后的基本信息 schema */
export function resolveProfileCategory(ov: SchemaOverrides): CategoryDef {
  return applyOverride(PROFILE_CATEGORY, ov)
}

/** 合并后的全部资料分类（含隐藏分类，调用方自行过滤） */
export function resolveCategories(ov: SchemaOverrides): CategoryDef[] {
  const all = [...BUILTIN_CATEGORIES, ...ov.customCategories.map((c) => ({ ...c, custom: true }))].map((c) =>
    applyOverride(c, ov)
  )
  if (ov.categoryOrder?.length) {
    const idx = (id: string) => {
      const i = ov.categoryOrder!.indexOf(id)
      return i === -1 ? Number.MAX_SAFE_INTEGER : i
    }
    return all.map((c, i) => ({ c, i })).sort((a, b) => idx(a.c.id) - idx(b.c.id) || a.i - b.i).map((x) => x.c)
  }
  return all
}

export function visibleFields(def: CategoryDef): FieldDef[] {
  return def.fields.filter((f) => !f.hidden)
}

/** 把字段值格式化为可读文本 */
export function formatValue(v: unknown): string {
  if (v == null) return ''
  if (Array.isArray(v)) return v.filter(Boolean).join('、')
  return String(v).trim()
}

/** 时间段文本，如 2021.09 - 2025.06 */
export function periodText(data: Record<string, unknown>): string {
  const s = formatValue(data.start).replace('-', '.')
  const e = formatValue(data.end).replace('-', '.')
  if (!s && !e) return formatValue(data.date).replace('-', '.')
  return `${s || '?'} - ${e || '至今'}`
}

/** 条目标题 */
export function entryTitle(def: CategoryDef | undefined, data: Record<string, unknown>): string {
  if (!def) return '(未知分类)'
  return formatValue(data[def.titleField]) || '(未命名)'
}

/** 把一条资料转为一段可粘贴文字 */
export function entryToParagraph(def: CategoryDef, data: Record<string, unknown>): string {
  const lines: string[] = []
  const title = entryTitle(def, data)
  const period = periodText(data)
  const sub = (def.subtitleFields ?? []).map((k) => formatValue(data[k])).filter(Boolean).join(' | ')
  lines.push([title, sub, period].filter(Boolean).join('  '))
  const skip = new Set([def.titleField, ...(def.subtitleFields ?? []), 'start', 'end', 'date'])
  for (const f of visibleFields(def)) {
    if (skip.has(f.key) || f.sensitive) continue
    const v = formatValue(data[f.key])
    if (v) lines.push(`${f.label}：${v}`)
  }
  return lines.join('\n')
}

/** 生成新字段 key */
export function makeFieldKey(): string {
  return 'c_' + Math.random().toString(36).slice(2, 8)
}
