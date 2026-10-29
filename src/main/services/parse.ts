import mammoth from 'mammoth'

/** 提取 .docx 纯文本 */
export async function extractDocxText(filePath: string): Promise<string> {
  const r = await mammoth.extractRawText({ path: filePath })
  return r.value.replace(/\n{3,}/g, '\n\n').trim()
}
