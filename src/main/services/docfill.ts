import fs from 'fs'
import path from 'path'
import AdmZip from 'adm-zip'
import type {
  Database,
  DocFillAnalysis,
  DocFillAnswerInput,
  DocFillSlot,
  DocFillWriteRequest,
  DocFillWriteResult
} from '@shared/types'
import { resolveProfileCategory } from '@shared/categories'
import type { ResolvedModel } from './settings'
import type { Store } from './store'
import { chat } from './ai/client'
import { parseModelJson } from './ai/extract'
import { buildProfileContext } from './ai/prompts'
import { extractDocxText } from './parse'

function decodeXml(str: string): string {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function encodeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

/** 提取一段 XML（如 <w:tc> 或 <w:p>）内的纯文本 */
function extractXmlText(xmlFragment: string): string {
  const paragraphs = xmlFragment.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g)
  if (!paragraphs || paragraphs.length === 0) {
    const texts: string[] = []
    const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g
    let m: RegExpExecArray | null
    while ((m = re.exec(xmlFragment)) !== null) {
      texts.push(decodeXml(m[1]))
    }
    return texts.join('').trim()
  }

  const pTexts: string[] = []
  for (const p of paragraphs) {
    const runs: string[] = []
    const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g
    let m: RegExpExecArray | null
    while ((m = re.exec(p)) !== null) {
      runs.push(decodeXml(m[1]))
    }
    pTexts.push(runs.join(''))
  }
  return pTexts.join('\n').trim()
}

/**
 * 将一段或多段文本写入 <w:tc> 内部，保留原有的 <w:tcPr>、首个 <w:pPr> 与首个 <w:rPr>
 */
function replaceTableCellText(tcXml: string, newValue: string): string {
  const tcOpenMatch = tcXml.match(/^<w:tc(?:\s[^>]*)?>/)
  if (!tcOpenMatch) return tcXml
  const tcOpen = tcOpenMatch[0]

  const tcPrMatch = tcXml.match(/<w:tcPr(?:\s[^>]*)?>[\s\S]*?<\/w:tcPr>|<w:tcPr\s*\/>/)
  const tcPr = tcPrMatch ? tcPrMatch[0] : ''

  const firstP = tcXml.match(/<w:p(?:\s[^>]*)?>([\s\S]*?)<\/w:p>/)
  const pPrMatch = firstP ? firstP[1].match(/<w:pPr(?:\s[^>]*)?>[\s\S]*?<\/w:pPr>|<w:pPr\s*\/>/) : null
  const pPr = pPrMatch ? pPrMatch[0] : ''

  // 提取原有非空或首个 <w:rPr>
  let rPr = ''
  if (firstP) {
    const rPrMatch = firstP[1].match(/<w:r(?:\s[^>]*)?>\s*(<w:rPr(?:\s[^>]*)?>[\s\S]*?<\/w:rPr>)/)
    if (rPrMatch) rPr = rPrMatch[1]
  }

  const lines = newValue.split(/\r?\n/)
  const newParagraphs = lines
    .map((line) => `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${encodeXml(line)}</w:t></w:r></w:p>`)
    .join('')

  return `${tcOpen}${tcPr}${newParagraphs}</w:tc>`
}

export const PHOTO_SLOT_MARKER = '[已关联个人证件照，写入时将自动嵌入一寸照片]'

/** 判断一个单元格文本或栏目标签是否为「照片/证件照」格 */
export function isPhotoCellLabel(text: string): boolean {
  const s = text.replace(/\s+/g, '').trim()
  if (!s || s.length > 20) return false
  if (/^(?:贴|近期|一寸|二寸|1寸|2寸|免冠|个人|电子|彩色|白底|蓝底|红底|正面|半身)*?(?:照片|相片|寸照|证件照)(?:处|栏|格|位置|区)?$/.test(s)) {
    return true
  }
  if (/(?:一寸|二寸|免冠|贴|近期).*(?:照片|相片|寸照)/.test(s)) {
    return true
  }
  return false
}

/**
 * 将个人证件照嵌入 .docx 压缩包的 word/media、Content_Types 与 document.xml.rels，返回关系 ID (rId)
 */
function embedAvatarIntoDocxZip(zip: AdmZip, avatarAbsPath: string): string {
  const rawExt = path.extname(avatarAbsPath).toLowerCase().replace(/^\./, '')
  const ext = rawExt === 'jpg' || rawExt === 'jpeg' ? 'jpeg' : rawExt === 'gif' ? 'gif' : rawExt === 'bmp' ? 'bmp' : 'png'
  const mime =
    ext === 'jpeg'
      ? 'image/jpeg'
      : ext === 'gif'
        ? 'image/gif'
        : ext === 'bmp'
          ? 'image/bmp'
          : 'image/png'

  const mediaFileName = `personal_profile_avatar.${ext}`
  const mediaZipPath = `word/media/${mediaFileName}`
  const imgBuf = fs.readFileSync(avatarAbsPath)
  zip.addFile(mediaZipPath, imgBuf)

  // 1. 确保 [Content_Types].xml 包含该图片扩展名声明
  const ctEntry = zip.getEntry('[Content_Types].xml')
  if (ctEntry) {
    let ctXml = ctEntry.getData().toString('utf-8')
    const extRegex = new RegExp(`Extension="${ext}"`, 'i')
    if (!extRegex.test(ctXml)) {
      ctXml = ctXml.replace(
        /<\/Types>/i,
        `<Default Extension="${ext}" ContentType="${mime}"/></Types>`
      )
      zip.updateFile('[Content_Types].xml', Buffer.from(ctXml, 'utf-8'))
    }
  }

  // 2. 在 word/_rels/document.xml.rels 中注册 Relationship
  const relsPath = 'word/_rels/document.xml.rels'
  const relId = 'rIdPersonalProfilePhoto99'
  const relEntry = zip.getEntry(relsPath)
  if (relEntry) {
    let relXml = relEntry.getData().toString('utf-8')
    if (!relXml.includes(`Id="${relId}"`)) {
      relXml = relXml.replace(
        /<\/Relationships>/i,
        `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${mediaFileName}"/></Relationships>`
      )
      zip.updateFile(relsPath, Buffer.from(relXml, 'utf-8'))
    }
  } else {
    const newRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${mediaFileName}"/>
</Relationships>`
    zip.addFile(relsPath, Buffer.from(newRelsXml, 'utf-8'))
  }

  return relId
}

/**
 * 将表格单元格 <w:tc> 内容替换为居中排布的一寸证件照 (<w:drawing>)，保留原有 <w:tcPr>
 */
function replaceTableCellWithPhoto(tcXml: string, relId: string): string {
  const tcOpenMatch = tcXml.match(/^<w:tc(?:\s[^>]*)?>/)
  if (!tcOpenMatch) return tcXml
  const tcOpen = tcOpenMatch[0]

  const tcPrMatch = tcXml.match(/<w:tcPr(?:\s[^>]*)?>[\s\S]*?<\/w:tcPr>|<w:tcPr\s*\/>/)
  const tcPr = tcPrMatch ? tcPrMatch[0] : ''

  // 标准一寸证件照尺寸：约 26mm x 36mm（1mm = 36000 EMUs -> cx = 936000, cy = 1296000）
  const cx = 936000
  const cy = 1296000

  const drawingXml = `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="9901" name="IDPhoto"/><wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="9902" name="avatar"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`

  return `${tcOpen}${tcPr}${drawingXml}</w:tc>`
}

/**
 * 将文本写入段落 <w:p>：
 * 若原段落存在下划线 "____" 或占位符 "{{...}}"，且用户只给了一个短值（不含原标签），则智能替换下划线/占位符；
 * 否则用 newValue 替换整个段落文本，保留 <w:pPr> 与 <w:rPr>。
 */
function replaceParagraphText(pXml: string, currentText: string, newValue: string): string {
  const pOpenMatch = pXml.match(/^<w:p(?:\s[^>]*)?>/)
  if (!pOpenMatch) return pXml
  const pOpen = pOpenMatch[0]

  const pPrMatch = pXml.match(/<w:pPr(?:\s[^>]*)?>[\s\S]*?<\/w:pPr>|<w:pPr\s*\/>/)
  const pPr = pPrMatch ? pPrMatch[0] : ''

  const rPrMatch = pXml.match(/<w:r(?:\s[^>]*)?>\s*(<w:rPr(?:\s[^>]*)?>[\s\S]*?<\/w:rPr>)/)
  const rPr = rPrMatch ? rPrMatch[1] : ''

  let finalText = newValue
  if (currentText && !newValue.includes(currentText.slice(0, 2))) {
    if (/_{2,}|＿{2,}/.test(currentText)) {
      finalText = currentText.replace(/_{2,}|＿{2,}/, newValue)
    } else if (/\{\{[^}]+\}\}/.test(currentText)) {
      finalText = currentText.replace(/\{\{[^}]+\}\}/, newValue)
    } else if (/【\s*】|\(\s*\)|（\s*）/.test(currentText)) {
      finalText = currentText.replace(/【\s*】|\(\s*\)|（\s*）/, newValue)
    } else if (/[:：]\s*$/.test(currentText.trim())) {
      finalText = `${currentText.trim()}${newValue}`
    }
  }

  const lines = finalText.split(/\r?\n/)
  const runs = lines
    .map((line, i) => `${i > 0 ? '<w:br/>' : ''}<w:t xml:space="preserve">${encodeXml(line)}</w:t>`)
    .join('')

  return `${pOpen}${pPr}<w:r>${rPr}${runs}</w:r></w:p>`
}

export interface ParsedDocStructure {
  kind: 'docx' | 'text'
  slotMap: Map<string, string>
  structurePrompt: string
}

/**
 * 解析 .docx 或文本模板文件的结构，为每个表格单元格/段落生成唯一 slotId
 */
export function extractDocStructure(filePath: string): ParsedDocStructure {
  const ext = path.extname(filePath).toLowerCase()
  const slotMap = new Map<string, string>()

  if (ext === '.docx') {
    const zip = new AdmZip(filePath)
    const entry = zip.getEntry('word/document.xml')
    if (!entry) {
      throw new Error('无法解析该 Word 文档（未找到 word/document.xml，请确认文件为 .docx 格式）')
    }
    const xml = entry.getData().toString('utf-8')
    const outLines: string[] = []

    // 1. 提取所有表格 <w:tbl>
    const tables = xml.match(/<w:tbl(?:\s[^>]*)?>[\s\S]*?<\/w:tbl>/g) ?? []
    tables.forEach((tblXml, tIdx) => {
      outLines.push(`【表格 #${tIdx}】`)
      const rows = tblXml.match(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g) ?? []
      rows.forEach((trXml, rIdx) => {
        const cells = trXml.match(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g) ?? []
        const cellDescs: string[] = []
        cells.forEach((tcXml, cIdx) => {
          // 检查是否为纵向合并的被合并单元格（<w:vMerge/> 且无 restart）
          const vMergeMatch = tcXml.match(/<w:vMerge(?:\s+w:val="([^"]*)")?\s*\/>/)
          const isMergedContinuation = Boolean(vMergeMatch && vMergeMatch[1] !== 'restart')
          if (isMergedContinuation) {
            cellDescs.push(`(同上合并格)`)
            return
          }
          const slotId = `tc:${tIdx}:${rIdx}:${cIdx}`
          const text = extractXmlText(tcXml)
          slotMap.set(slotId, text)
          const display = text ? `"${text.replace(/\n/g, ' / ')}"` : `""(空白待填)`
          cellDescs.push(`[${slotId}] ${display}`)
        })
        if (cellDescs.length > 0) {
          outLines.push(`  第 ${rIdx} 行: ${cellDescs.join('  |  ')}`)
        }
      })
      outLines.push('')
    })

    // 2. 提取表格外的顶层段落 <w:p>
    const xmlWithoutTables = xml.replace(/<w:tbl(?:\s[^>]*)?>[\s\S]*?<\/w:tbl>/g, '')
    const paras = xmlWithoutTables.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) ?? []
    const paraLines: string[] = []
    paras.forEach((pXml, pIdx) => {
      const text = extractXmlText(pXml)
      if (!text) return
      const slotId = `p:${pIdx}`
      slotMap.set(slotId, text)
      paraLines.push(`  [${slotId}] "${text}"`)
    })
    if (paraLines.length > 0) {
      outLines.push(`【表格外段落】`)
      outLines.push(...paraLines)
    }

    return {
      kind: 'docx',
      slotMap,
      structurePrompt: outLines.join('\n')
    }
  }

  // 文本类文件（.txt / .md / .csv / .tsv / .html）
  const content = fs.readFileSync(filePath, 'utf-8')
  const lines = content.split(/\r?\n/)
  const outLines: string[] = ['【文本/表格行结构】']
  lines.forEach((line, idx) => {
    const slotId = `line:${idx}`
    slotMap.set(slotId, line)
    if (line.trim()) {
      outLines.push(`  [${slotId}] ${line}`)
    }
  })

  return {
    kind: 'text',
    slotMap,
    structurePrompt: outLines.join('\n')
  }
}

export function getDefaultNewPath(filePath: string): string {
  const dir = path.dirname(filePath)
  const ext = path.extname(filePath)
  const base = path.basename(filePath, ext)
  return path.join(dir, `${base}_已填写${ext}`)
}

/**
 * 构建包含基本信息、全部分类经历/文献、已保存问答库、以及文档附件摘要的完整检索上下文
 */
export async function buildFullRetrievalContext(
  db: Database,
  absOf?: (rel: string) => string
): Promise<string> {
  const parts: string[] = []

  // 1. 基本信息（含敏感字段如身份证号以外的全部字段 + 用户曾回答并保存的自定义字段）
  // 在本地文件填表场景下，也附上非空身份证号等（仅当用户已填写时）方便填表，或由 profileContext 提供
  const baseCtx = buildProfileContext(db, undefined, true)
  if (baseCtx) parts.push(baseCtx)

  // 如果基本信息中有被标为 sensitive 但用户已主动录入的值（如身份证号），提供给本地填表检索
  const idNum = db.profile?.data?.idNumber
  if (typeof idNum === 'string' && idNum.trim()) {
    parts.push(`【补充证件信息】\n身份证号：${idNum.trim()}`)
  }

  // 2. 已保存的问答与自我介绍库（Snippets）
  if (db.snippets && db.snippets.length > 0) {
    const snippetLines = db.snippets.map(
      (s, i) => `(${i + 1}) 标题/问题：${s.title}${s.requirement && s.requirement !== s.title ? `（要求：${s.requirement}）` : ''}\n内容：${s.content}`
    )
    parts.push(`【已存问答与自我介绍记忆库】\n${snippetLines.join('\n\n')}`)
  }

  // 3. 检索挂载的 .docx / .txt 文献或证明附件内容摘要（最多取前 5 个可读文档）
  if (absOf) {
    const docSnippets: string[] = []
    const allAtts = [
      ...(db.profile?.attachments ?? []).map((a) => ({ owner: '基本信息', att: a })),
      ...(db.entries ?? []).flatMap((e) =>
        (e.attachments ?? []).map((a) => ({
          owner: `${e.category}:${String(Object.values(e.data)[0] ?? '')}`,
          att: a
        }))
      )
    ]
    let readCount = 0
    for (const { owner, att } of allAtts) {
      if (readCount >= 5) break
      const ext = path.extname(att.fileName).toLowerCase()
      if (ext !== '.docx' && ext !== '.txt' && ext !== '.md') continue
      try {
        const abs = absOf(att.relPath)
        if (!fs.existsSync(abs)) continue
        const txt =
          ext === '.docx'
            ? await extractDocxText(abs)
            : fs.readFileSync(abs, 'utf-8')
        if (txt && txt.trim()) {
          docSnippets.push(`《${att.fileName}》（关联：${owner}）：\n${txt.trim().slice(0, 1200)}`)
          readCount++
        }
      } catch {
        // ignore unreadable attachment
      }
    }
    if (docSnippets.length > 0) {
      parts.push(`【文献与附件原文检索库】\n${docSnippets.join('\n\n')}`)
    }
  }

  return parts.join('\n\n')
}

/**
 * 解析待填写文件，调用 AI 检索个人资料库与文献库：
 * - 能查找到的填好 value，status = 'filled'
 * - 查不到的绝不胡编乱造，status = 'missing'，生成向用户的提问 question 及入库键名 saveKey
 */
export async function analyzeDocForFill(
  m: ResolvedModel,
  filePath: string,
  db: Database,
  absOf?: (rel: string) => string
): Promise<DocFillAnalysis> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`文件不存在：${filePath}`)
  }

  const parsed = extractDocStructure(filePath)
  const context = await buildFullRetrievalContext(db, absOf)

  const systemPrompt = `你是一位严谨的个人资料与文献库检索填表专家。用户提供了一份需要填写的文档/表格结构（每个位置带有唯一标识 slotId，如 [tc:0:0:1] 表示表格0第0行第1列空白格，[p:2] 表示第2段落，[line:3] 表示第3行）。
请检索【个人资料库与文献库】，找出文档中所有需要填写的栏目位置并进行匹配。

【核心铁律：严禁胡编乱造】
1. 只能依据【个人资料库与文献库】中明确存在的事实进行填写！
2. 如果某个待填栏目在资料库中找不到对应信息（例如：资料库未录入“学号”、“指导教师”、“通讯地址”、“紧急联系人”、“民族”、“期望薪资”，或者某道主观问答题在资料库中无据可依）：
   - 严禁猜测、严禁编造任何虚假内容、严禁填写“无 / 暂无 / XXX / 待补充”充数！
   - 必须将该项的 status 设为 "missing"，value 设为 ""，并在 question 中礼貌、明确地向用户提问（如："资料库中未找到您的「学号」，请问您的学号是多少？"）。
   - 同时提供 saveKey（简短规范的属性名或问题标题，如 "学号"、"指导教师"、"家庭通讯地址"）和 saveKind（短属性填 "profile"，长篇主观问答填 "snippet"），以便系统收到用户回答后永久记录到资料库供后续复用。
3. 对于综合汇总类栏目（如“个人简介”、“科研与论文发表情况”、“项目经历”、“获奖情况汇总”），如果资料库中有对应的经历或论文条目，请检索汇总并整理为自然、平实、去 AI 味的条目文本填入（status 设为 "filled"）；只有当资料库中连相关经历都完全为空时才设为 "missing"。
4. 语言风格要求：平实、客观、干练，杜绝“赋能、抓手、闭环、深耕、卓越、全方位”等假大空 AI 套话。
5. 注意 slotId 的选择：
   - 在表格中，如果 [tc:0:0:0] 是标签 "姓名"，而它右侧相邻的 [tc:0:0:1] 是 ""(空白待填)，则应当填写的 slotId 是 "tc:0:0:1"（空白格），label 填 "姓名"，value 填具体姓名（不要把值写进标签格里）。
   - 如果某个大栏目标题占了一整行（如第 4 行 [tc:0:4:0] 是 "获奖情况"），而第 5 行 [tc:0:5:0] 是 ""(空白待填)，则应当填写的 slotId 是 "tc:0:5:0"，label 填 "获奖情况"。
   - 如果表格中存在多行空白子表格（例如表头是“获奖时间 | 奖项名称 | 颁奖单位”，下方有连续多行空白格），请将资料库中的多条经历按行依次拆分填入每一行对应的单元格中，而不是全部挤在第一行。
   - 如果表格中某个单元格本身写着“照片”、“一寸免冠照片”、“贴照片处”（或者“照片”右侧的空白格），请将该单元格作为待填 slotId 输出，label 设为 "个人证件照"。
   - 如果是段落 [p:X] 或文本行 [line:X] 含有下划线或冒号填空（如 "申请人姓名：________"），则 slotId 填 "p:X" 或 "line:X"，value 填完整替换后的文本或对应填入值。

【严格输出 JSON 格式】
{
  "slots": [
    {
      "slotId": "tc:0:0:1",
      "label": "栏目名称（如：姓名）",
      "status": "filled 或 missing",
      "value": "status为filled时填入的真实内容；status为missing时必须为 \"\"",
      "source": "status为filled时说明检索来源（如：基本信息-姓名 / 论文发表2篇 / 教育经历）",
      "question": "status为missing时向用户提出的追问（如：资料库中未找到您的「学号」，请补充：）",
      "saveKey": "用于保存用户回答的字段名或问答标题（如：学号）",
      "saveKind": "profile 或 snippet"
    }
  ]
}
仅输出合法 JSON，不要包含任何额外解释。`

  const userPrompt = `【个人资料库与文献库】
${context || '（当前资料库为空）'}

【待填写文档结构】
${parsed.structurePrompt.slice(0, 28000)}

请检索资料库并输出所有待填位置的 JSON：`

  const raw = await chat(
    m,
    [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    { json: true, temperature: 0.2 }
  )

  const json = parseModelJson(raw) as { slots?: unknown[] }
  const rawSlots = Array.isArray(json?.slots) ? json.slots : []

  const slots: DocFillSlot[] = []
  const seen = new Set<string>()
  const hasAvatar = Boolean(
    db.profile?.avatarRelPath && absOf && fs.existsSync(absOf(db.profile.avatarRelPath))
  )

  for (const item of rawSlots) {
    if (!item || typeof item !== 'object') continue
    const rec = item as Record<string, unknown>
    const slotId = String(rec.slotId ?? '').trim()
    if (!slotId || seen.has(slotId) || !parsed.slotMap.has(slotId)) continue
    seen.add(slotId)

    const label = String(rec.label ?? slotId).trim()
    const currentText = parsed.slotMap.get(slotId) ?? ''
    const isPhoto =
      parsed.kind === 'docx' &&
      slotId.startsWith('tc:') &&
      (isPhotoCellLabel(label) || isPhotoCellLabel(currentText))

    if (isPhoto) {
      slots.push({
        slotId,
        label: '个人证件照',
        currentText,
        status: hasAvatar ? 'filled' : 'missing',
        value: hasAvatar ? PHOTO_SLOT_MARKER : '',
        source: hasAvatar ? '基本信息-个人证件照（自动嵌入图片）' : undefined,
        question: hasAvatar
          ? undefined
          : '检测到表格中包含「照片/证件照」栏，请点击右侧按钮上传您的证件照（将自动嵌入此单元格并保存至基本信息）',
        saveKey: '个人证件照',
        saveKind: 'profile',
        isPhoto: true
      })
      continue
    }

    const rawVal = rec.value == null ? '' : String(rec.value).trim()
    const isMissing = rec.status === 'missing' || !rawVal
    const saveKind = rec.saveKind === 'snippet' ? 'snippet' : 'profile'
    const saveKey = String(rec.saveKey ?? label).trim()

    slots.push({
      slotId,
      label,
      currentText,
      status: isMissing ? 'missing' : 'filled',
      value: isMissing ? '' : rawVal,
      source: !isMissing && rec.source ? String(rec.source).trim() : undefined,
      question: isMissing
        ? String(rec.question || `资料库中未找到「${label}」，请补充填写（回答后将自动记入资料库）：`).trim()
        : undefined,
      saveKey,
      saveKind
    })
  }

  // 确定性兜底扫描：如果 .docx 表格中存在写着“照片/一寸免冠照片/贴照片处”的单元格未被 AI 列入，自动加入证件照槽位
  if (parsed.kind === 'docx' && !slots.some((s) => s.isPhoto)) {
    for (const [slotId, cellText] of parsed.slotMap.entries()) {
      if (!slotId.startsWith('tc:')) continue
      if (isPhotoCellLabel(cellText) && !seen.has(slotId)) {
        seen.add(slotId)
        slots.push({
          slotId,
          label: '个人证件照',
          currentText: cellText,
          status: hasAvatar ? 'filled' : 'missing',
          value: hasAvatar ? PHOTO_SLOT_MARKER : '',
          source: hasAvatar ? '基本信息-个人证件照（自动嵌入图片）' : undefined,
          question: hasAvatar
            ? undefined
            : '检测到表格中包含「照片/证件照」栏，请点击右侧按钮上传您的证件照（将自动嵌入此单元格并保存至基本信息）',
          saveKey: '个人证件照',
          saveKind: 'profile',
          isPhoto: true
        })
        break
      }
    }
  }

  return {
    filePath,
    fileName: path.basename(filePath),
    defaultNewPath: getDefaultNewPath(filePath),
    slots
  }
}

/**
 * 将用户针对缺失项补充的回答永久记录到资料库（基本信息字段或问答记忆库），供后续自动复用
 */
export function saveDocFillAnswers(store: Store, answers: DocFillAnswerInput[]): void {
  const valid = answers.filter((a) => a.answer && a.answer.trim())
  if (valid.length === 0) return

  const db = store.getDb()
  const profileCat = resolveProfileCategory(db.schema)
  const profileData = { ...(db.profile?.data ?? {}) }
  const schema = structuredClone(db.schema ?? { categories: {}, customCategories: [] })
  let profileChanged = false
  let schemaChanged = false

  for (const item of valid) {
    const ans = item.answer.trim()
    const keyName = (item.saveKey || item.label || '').trim()
    if (!keyName) continue

    const isLongSnippet =
      item.saveKind === 'snippet' || ans.length > 80 || ans.includes('\n')

    if (isLongSnippet) {
      // 检查是否已有同名问答，若有则更新，否则新增
      const existingSnippet = db.snippets.find((s) => s.title === keyName)
      store.saveSnippet({
        id: existingSnippet?.id,
        title: keyName,
        requirement: item.label || keyName,
        content: ans
      })
    } else {
      // 查找基本信息中是否已有匹配的字段（按 key 或 label 匹配）
      const existingField = profileCat.fields.find(
        (f) =>
          f.key.toLowerCase() === keyName.toLowerCase() ||
          f.label.toLowerCase() === keyName.toLowerCase()
      )
      if (existingField) {
        profileData[existingField.key] = ans
        profileChanged = true
      } else {
        // 自动在基本信息 schema 中注册该自定义字段，确保界面可查看、后续可检索
        if (!schema.categories.profile) {
          schema.categories.profile = {}
        }
        const extras = schema.categories.profile.extraFields ?? []
        let customField = extras.find((f) => f.label === keyName)
        if (!customField) {
          const customKey = `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 5)}`
          customField = {
            key: customKey,
            label: keyName,
            type: 'text',
            custom: true
          }
          extras.push(customField)
          schema.categories.profile.extraFields = extras
          schemaChanged = true
        }
        profileData[customField.key] = ans
        profileChanged = true
      }
    }
  }

  if (schemaChanged) {
    store.saveSchema(schema)
  }
  if (profileChanged) {
    store.saveProfile(profileData)
  }
}

/**
 * 将填写好的槽位写回原文件或另存为新文件（默认保存在原文件同一文件夹）
 */
export function writeFilledDoc(
  req: DocFillWriteRequest,
  avatarAbsPath?: string
): DocFillWriteResult {
  const { sourcePath, mode, slots } = req
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`源文件路径不存在：${sourcePath}`)
  }

  const outPath =
    mode === 'overwrite'
      ? sourcePath
      : req.targetPath?.trim() || getDefaultNewPath(sourcePath)

  const ext = path.extname(sourcePath).toLowerCase()
  const slotValueMap = new Map<string, string>()
  for (const s of slots) {
    if (s.value != null && String(s.value).trim() !== '') {
      slotValueMap.set(s.slotId, String(s.value))
    }
  }

  let filledCount = 0

  if (ext === '.docx') {
    const zip = new AdmZip(sourcePath)
    const entry = zip.getEntry('word/document.xml')
    if (!entry) {
      throw new Error('无效的 .docx 文件，缺少 word/document.xml')
    }
    let xml = entry.getData().toString('utf-8')

    // 若包含需要嵌入证件照的槽位且本地存在个人照片，则先把照片写入 docx 媒体库
    const hasPhotoSlot = Array.from(slotValueMap.values()).some((v) => v === PHOTO_SLOT_MARKER)
    const validAvatarPath =
      hasPhotoSlot && avatarAbsPath && fs.existsSync(avatarAbsPath) ? avatarAbsPath : undefined
    const photoRelId = validAvatarPath ? embedAvatarIntoDocxZip(zip, validAvatarPath) : null

    // 1. 替换表格单元格 tc:t:r:c
    let tIdx = -1
    xml = xml.replace(/<w:tbl(?:\s[^>]*)?>[\s\S]*?<\/w:tbl>/g, (tblXml) => {
      tIdx++
      let rIdx = -1
      return tblXml.replace(/<w:tr(?:\s[^>]*)?>[\s\S]*?<\/w:tr>/g, (trXml) => {
        rIdx++
        let cIdx = -1
        return trXml.replace(/<w:tc(?:\s[^>]*)?>[\s\S]*?<\/w:tc>/g, (tcXml) => {
          cIdx++
          const slotId = `tc:${tIdx}:${rIdx}:${cIdx}`
          const val = slotValueMap.get(slotId)
          if (val !== undefined) {
            if (val === PHOTO_SLOT_MARKER) {
              if (photoRelId) {
                filledCount++
                return replaceTableCellWithPhoto(tcXml, photoRelId)
              }
              return tcXml
            }
            filledCount++
            return replaceTableCellText(tcXml, val)
          }
          return tcXml
        })
      })
    })

    // 2. 替换顶层段落 p:idx（如有）
    const hasParaSlots = Array.from(slotValueMap.keys()).some((k) => k.startsWith('p:'))
    if (hasParaSlots) {
      // 将 <w:tbl> 暂时占位，以免匹配到表格内部的 <w:p>
      const savedTables: string[] = []
      const placeholderXml = xml.replace(/<w:tbl(?:\s[^>]*)?>[\s\S]*?<\/w:tbl>/g, (m) => {
        savedTables.push(m)
        return `__TABLE_PLACEHOLDER_${savedTables.length - 1}__`
      })

      let pIdx = -1
      const updatedPlaceholderXml = placeholderXml.replace(
        /<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g,
        (pXml) => {
          const text = extractXmlText(pXml)
          if (!text) return pXml
          pIdx++
          const slotId = `p:${pIdx}`
          const val = slotValueMap.get(slotId)
          if (val !== undefined) {
            filledCount++
            return replaceParagraphText(pXml, text, val)
          }
          return pXml
        }
      )

      xml = updatedPlaceholderXml.replace(/__TABLE_PLACEHOLDER_(\d+)__/g, (_, i) => savedTables[Number(i)])
    }

    zip.updateFile('word/document.xml', Buffer.from(xml, 'utf-8'))
    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    const tmpPath = `${outPath}.tmp-${Date.now()}`
    zip.writeZip(tmpPath)
    fs.renameSync(tmpPath, outPath)

    return { outPath, filledCount }
  }

  // 文本类模板文件（.txt / .md / .csv / .tsv / .html）
  const content = fs.readFileSync(sourcePath, 'utf-8')
  const lineBreak = content.includes('\r\n') ? '\r\n' : '\n'
  const lines = content.split(/\r?\n/)

  const newLines = lines.map((line, idx) => {
    const slotId = `line:${idx}`
    const val = slotValueMap.get(slotId)
    if (val === undefined) return line
    filledCount++
    if (line && !val.includes(line.slice(0, 2))) {
      if (/_{2,}|＿{2,}/.test(line)) return line.replace(/_{2,}|＿{2,}/, val)
      if (/\{\{[^}]+\}\}/.test(line)) return line.replace(/\{\{[^}]+\}\}/, val)
      if (/[:：]\s*$/.test(line.trim())) return `${line.trim()}${val}`
    }
    return val
  })

  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  const tmpPath = `${outPath}.tmp-${Date.now()}`
  fs.writeFileSync(tmpPath, newLines.join(lineBreak), 'utf-8')
  fs.renameSync(tmpPath, outPath)

  return { outPath, filledCount }
}
