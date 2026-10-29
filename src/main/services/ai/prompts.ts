import type { BatchFillRequest, Database, FieldDef, GenerateRequest, PolishFieldRequest } from '@shared/types'
import {
  entryToParagraph,
  formatValue,
  resolveCategories,
  resolveProfileCategory,
  visibleFields
} from '@shared/categories'
import type { ChatMessage } from './client'

/** 反 AI 腔与去套话通用准则 */
export const ANTI_AI_CLICHE_RULES = `【去 AI 味铁律（必遵）】
1. 严禁使用互联网黑话与 AI 高频套话，包括但不限于：“赋能、抓手、闭环、沉淀、深耕、致力于、助力、全方位、全链路、从0到1、卓越、极具、完美解决、显著增强了鲁棒性、展现出强大的…能力、值得一提的是、综上所述、总而言之、不仅…而且…、此外、与此同时”。
2. 严禁使用死板的“AI 八股文”分段公式：严禁出现“在学习/学业方面，我…；在科研/竞赛方面，我…；在学生工作/实践方面，我…；综上所述/展望未来…”这种一眼就能看出的模板式排比结构！也要避免生硬的“首先…其次…最后…”、“作为一名XX专业的学生，我深知…”等套路化开头。
3. 拒绝假大空的自我吹捧与情绪化形容词：不要写“具有极强的抗压能力与卓越的团队精神”、“怀揣着对科学的热忱”，要直接写具体做过的事、用过的技术/工具、产出的真实结果或客观指标。
4. 句式自然、平实、有真人呼吸感：像一个优秀、踏实的真人自己在娓娓道来或手写自述，用事实和细节串联上下文，过渡自然不刻意，短句为主，主谓宾干净利落。
5. 绝对忠于原文事实：原文只是普通开发、课程设计或常规工作，就平实准确地描述具体工作量，严禁强行拔高为“行业领先”、“架构级突破”或无中生有编造数据。`

function formatFieldForSchema(f: FieldDef): Record<string, unknown> {
  let typeDesc: string = f.type
  if (f.type === 'tags') typeDesc = 'string[] (字符串数组)'
  else if (f.type === 'month') typeDesc = 'YYYY-MM (如 2021-09)'
  else if (f.type === 'date') typeDesc = 'YYYY-MM-DD (如 2021-09-01)'

  const res: Record<string, unknown> = {
    key: f.key,
    label: f.label,
    type: typeDesc
  }
  if (f.options && f.options.length > 0) {
    res.options = f.options
  }
  if (f.required) {
    res.required = true
  }
  return res
}

export function buildSchemaDescription(db: Database): string {
  const profileCat = resolveProfileCategory(db.schema)
  const profileFields = visibleFields(profileCat)
    .filter((f) => !f.sensitive)
    .map(formatFieldForSchema)

  const categories = resolveCategories(db.schema)
    .filter((c) => !c.hidden)
    .map((c) => ({
      id: c.id,
      name: c.label,
      aiHint: c.aiHint || undefined,
      fields: visibleFields(c)
        .filter((f) => !f.sensitive)
        .map(formatFieldForSchema)
    }))

  const schema = {
    profile: {
      description: '基本个人信息（单例）',
      fields: profileFields
    },
    categories
  }

  return JSON.stringify(schema, null, 2)
}

export function buildExtractionSystemPrompt(db: Database): string {
  const schemaDesc = buildSchemaDescription(db)
  return `你是一个严谨的个人资料结构化提取助手。请从用户给出的材料（文本或图片）中提取真实个人信息并输出为严格的 JSON。

【目标数据结构规范】
${schemaDesc}

【输出格式要求】
严格输出以下 JSON 格式：
{
  "profile": {
    /* 提取到的基本信息字段 key 与对应的值 */
  },
  "entries": [
    {
      "category": "分类id（必须对应上述可用分类之一）",
      "data": {
        /* 该分类下存在的字段 key 与规范后的值 */
      },
      "tags": ["相关标签（可选）"]
    }
  ],
  "warnings": [
    "无法归类或存疑的信息"
  ]
}

【提取规则】
1. 只提取原文明确出现的信息，严禁臆测、外推或编造任何经历、时间、成绩或事实。
2. 原文中没有的字段直接省略，不要输出 null 或空字符串。
3. 日期格式要求：
   - month 类型字段统一规范为 "YYYY-MM"（如 "2021-09"）。
   - 若某段经历目前仍在进行中，结束时间 end 字段填 "至今"。
   - date 类型字段统一规范为 "YYYY-MM-DD"（如 "2021-09-01"）。
4. 一份材料可能产生多个条目（例如一份简历可能包含多段教育经历、工作经历与项目经历；单张证书/奖状图片通常对应 1 个 award 或 certificate 条目）。
5. select 字段的值尽量映射到 schema 提供的可选值 options 之一。
6. 描述类长文本（如 responsibilities、achievements、description 等）保持原文平实客观的事实表述，分点叙述时每条以 "• " 开头，严禁添油加醋或改写为浮夸的 AI 腔套话。
7. 无法归类到已有分类、或者材料中存疑/模糊的信息，请放入 warnings 列表中。
8. 仅输出合法 JSON 字符串，不要输出额外的解释说明或 Markdown 包装外的前后导语。`
}

export function buildOrganizePrompt(categoryHint: string | undefined, db: Database): string {
  const schemaDesc = buildSchemaDescription(db)
  const hintClause = categoryHint
    ? `\n用户指定了分类提示：优先将主要经历归入分类 "${categoryHint}"。\n`
    : ''

  return `你是一个务实、严谨的个人经历梳理助手。请将用户口述或随手记录的经历整理为干净、平实的履历条目，并严格按照 JSON 格式输出。
${hintClause}
【目标数据结构规范】
${schemaDesc}

【输出格式要求】
严格输出以下 JSON 格式：
{
  "profile": {
    /* 基本信息字段 */
  },
  "entries": [
    {
      "category": "分类id",
      "data": {
        /* 该分类字段对应的值 */
      },
      "tags": ["标签"]
    }
  ],
  "warnings": [
    "无法归类或存疑的信息"
  ]
}

${ANTI_AI_CLICHE_RULES}

【整理规则】
1. 把口语化描述整理为自然、具体的书面语，清楚交代「做了什么事、用了什么方法/技术、具体结果是什么」，拆分填入背景（background）、职责（responsibilities）、成果（achievements）等字段。
2. 严禁编造原文中没有的数字、指标、获奖或事实！
3. 日期格式规范：month 格式为 "YYYY-MM"，正在进行的填 "至今"；date 格式为 "YYYY-MM-DD"。
4. 原文没有的字段直接省略。
5. 无法归类或不确定的信息放入 warnings。
6. 仅输出合法 JSON，不要输出任何额外的解释。`
}

export function buildProfileContext(
  db: Database,
  entryIds?: string[],
  includeProfile: boolean = true
): string {
  const sections: string[] = []

  // 1. 基本信息（严格排除所有 sensitive 字段）
  if (includeProfile) {
    const profileCat = resolveProfileCategory(db.schema)
    const lines: string[] = []
    for (const f of visibleFields(profileCat)) {
      if (f.sensitive) continue
      const v = formatValue(db.profile.data[f.key])
      if (v) {
        lines.push(`${f.label}：${v}`)
      }
    }
    if (lines.length > 0) {
      sections.push(`【基本信息】\n${lines.join('\n')}`)
    }
  }

  // 2. 条目信息
  const categories = resolveCategories(db.schema)
  const idSet = entryIds && entryIds.length > 0 ? new Set(entryIds) : null
  const entries = idSet ? db.entries.filter((e) => idSet.has(e.id)) : db.entries

  for (const cat of categories) {
    const catEntries = entries.filter((e) => e.category === cat.id)
    if (catEntries.length === 0) continue

    const paras: string[] = []
    for (const entry of catEntries) {
      const p = entryToParagraph(cat, entry.data)
      if (p.trim()) {
        paras.push(p.trim())
      }
    }

    if (paras.length > 0) {
      sections.push(`【${cat.label}】\n${paras.join('\n\n')}`)
    }
  }

  return sections.join('\n\n')
}

export function buildGeneratePrompt(req: GenerateRequest, db: Database): ChatMessage[] {
  const toneMap: Record<string, string> = {
    formal: '客观平实、得体自然、像真人手写的诚恳自述（不端着、不掉书袋、不堆砌公文套话）',
    concise: '干练精简、开门见山、全干货无客套',
    warm: '真诚接地气、像面对面自然交谈一样娓娓道来、谦逊踏实且有个人温度'
  }
  const toneDesc = toneMap[req.tone ?? 'formal'] ?? toneMap.formal

  let wordLimitDesc = ''
  if (req.wordLimit && req.wordLimit > 0) {
    const minWords = Math.floor(req.wordLimit * 0.85)
    wordLimitDesc = `\n字数限制：严格不得超过 ${req.wordLimit} 字（中文按汉字计数）。建议目标字数控制在上限的 85% ~ 100%（约 ${minWords} ~ ${req.wordLimit} 字）。`
  }

  const context = buildProfileContext(db, req.entryIds, req.includeProfile ?? true)
  const hasRefine = Boolean(req.currentText?.trim() && req.refineFeedback?.trim())

  const systemContent = `你是一位文笔极佳、深谙真人表达习惯的个人文书与简历写手。你最痛恨死板生硬的 AI 腔和八股文套路，擅长用最平实、具体、有生命力的真人语气把经历讲清楚。

${ANTI_AI_CLICHE_RULES}

【真人感写作法则】
1. 只能使用所提供资料里的真实事实，严禁编造任何经历、技能、数字或成就！
2. 打破分类罗列感：不要把教育、科研、竞赛、实践像报菜名一样机械分段（严禁写“在学业上…在科研上…在竞赛上…”），而是找到它们之间的内在联系，顺着“我是谁 → 我具体钻研/做过什么核心事情 → 取得了什么实在结果”自然连贯地展开。
3. 语气风格：${toneDesc}。${wordLimitDesc}
4. 严格输出限制：
   - 只输出修改/生成后的正文内容！
   - 严禁输出标题、小标题或主旨说明。
   - 严禁包含任何 Markdown 格式标记（如 **加粗**、# 标题、* 符号等），全部使用纯文本自然段落。
   - 严禁输出“好的，这是修改后的版本”等任何开场白、解释性说明或客套话。`

  if (hasRefine) {
    const userContent = `【背景经历资料（供核对事实与补充细节）】
${context || '（暂无详细经历资料）'}

【原始填写要求 / 栏目说明】
${req.requirement || '个人自述/文案撰写'}

【当前已生成的文本草稿】
${req.currentText!.trim()}

【⚠️ 用户提出的修改意见（最高优先级，必须严格落实）】
${req.refineFeedback!.trim()}

请严格按照用户的修改意见对【当前已生成的文本草稿】进行重写或针对性打磨，彻底去除死板的 AI 腔调，直接输出修改后的纯文本正文：`

    return [
      { role: 'system', content: systemContent },
      { role: 'user', content: userContent }
    ]
  }

  const userContent = `【背景经历资料】
${context || '（暂无详细经历资料）'}

【具体要求 / 栏目说明】
${req.requirement}

请根据以上真实资料，摒弃“在XX方面…综上所述…”等一切 AI 模板套路，用自然真实、贴合真人说话/手写习惯的语感直接输出正文：`

  return [
    { role: 'system', content: systemContent },
    { role: 'user', content: userContent }
  ]
}

export function buildBatchFillPrompt(req: BatchFillRequest, db: Database): ChatMessage[] {
  const context = buildProfileContext(db, undefined, true)
  const snippetsText =
    db.snippets && db.snippets.length > 0
      ? `\n\n【已存问答与自我介绍记忆库】\n` +
        db.snippets.map((s) => `- ${s.title}：${s.content}`).join('\n')
      : ''

  const systemContent = `你是一位严谨精准的智能填表助手。用户会提供一份报名表/网申表格的栏目列表（或表格截图），请检索用户的真实个人资料库与问答库，为每个栏目生成可直接复制粘贴的填写内容。

【输出 JSON 格式】
{
  "items": [
    {
      "field": "表格栏目/问题名称",
      "value": "可直接填入表格的内容（若资料中完全没有对应信息则必须填 \"\"，严禁编造）",
      "note": "可选备注：如资料来源说明、或缺失提示“资料库中未找到，请手动补充”"
    }
  ]
}

${ANTI_AI_CLICHE_RULES}

【匹配与填写规则】
1. 严禁胡编乱造！只能使用【个人资料库】和【已存问答与自我介绍记忆库】中的真实信息。
2. 短字段（如姓名、学校、专业、GPA、电话、邮箱、籍贯、政治面貌等）直接给出精准值。
3. 汇总型或问答型栏目（如“获奖情况汇总”、“代表性项目/科研经历”、“论文发表”、“个人简介”），请根据资料库整理出平实、客观、条理清晰的纯文本。
4. 如果某个栏目在资料库中没有对应信息，value 必须填 ""，并在 note 中提示“资料库未录入，请补充”。
5. 只输出合法的 JSON 对象，不要包含任何额外解释。`

  const textPrompt = `【个人资料库】
${context || '（暂无资料）'}${snippetsText}

${req.fieldsText?.trim() ? `【待填写的表格栏目 / 问题列表】\n${req.fieldsText.trim()}\n\n` : ''}请识别所有需要填写的表格栏目，并输出对应的 JSON：`

  if (req.imageDataUrl) {
    return [
      { role: 'system', content: systemContent },
      {
        role: 'user',
        content: [
          { type: 'text', text: textPrompt },
          { type: 'image_url', image_url: { url: req.imageDataUrl } }
        ]
      }
    ]
  }
  return [
    { role: 'system', content: systemContent },
    { role: 'user', content: textPrompt }
  ]
}

export function buildPolishFieldPrompt(req: PolishFieldRequest): ChatMessage[] {
  const ctxLines: string[] = []
  for (const [k, v] of Object.entries(req.entryContext ?? {})) {
    if (v != null && String(v).trim() && String(v) !== req.rawText) {
      ctxLines.push(`${k}: ${Array.isArray(v) ? v.join('、') : String(v)}`)
    }
  }
  const systemContent = `你是一位崇尚极简、务实文风的简历编辑。请对用户在「${req.categoryLabel} - ${req.fieldLabel}」中填写的草稿进行去 AI 味、平实干练的专业润色。

${ANTI_AI_CLICHE_RULES}

【润色规则】
1. 去除口语废话，同时也去除浮夸的“AI 味/互联网黑话”，保留最实在的「具体工作内容 + 技术/方法 + 真实结果」（多要点时使用 "• " 分点换行）。
2. 严禁无中生有或编造原文中不存在的数据、指标与技术栈！
3. 只输出润色后的纯文本正文，不要输出任何标题、解释或 Markdown 符号（如 **）。`

  const userContent = `${ctxLines.length ? `【当前条目其他字段参考】\n${ctxLines.join('\n')}\n\n` : ''}【待润色的「${req.fieldLabel}」草稿】
${req.rawText}

请直接输出平实、自然、无 AI 味的润色结果：`

  return [
    { role: 'system', content: systemContent },
    { role: 'user', content: userContent }
  ]
}
