import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { ExtractInput } from '@shared/types'
import type { FilePayload } from '@shared/ipc'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64)
  const len = binaryString.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i)
  }
  return bytes
}

/**
 * 提取 PDF 全部页文字；若平均每页有效字符 < 50（判定为扫描件），
 * 将前 4 页渲染为 PNG dataURL 放入 images，否则放入 text。
 */
export async function pdfToExtractInput(base64: string, filePath: string, fileName: string): Promise<ExtractInput> {
  const data = base64ToUint8Array(base64)
  const loadingTask = pdfjs.getDocument({ data })
  const doc = await loadingTask.promise

  try {
    const pageTexts: string[] = []
    let totalChars = 0

    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const textContent = await page.getTextContent()
      let pageText = ''
      for (const item of textContent.items) {
        if ('str' in item) {
          pageText += item.str
          if (item.hasEOL) {
            pageText += '\n'
          }
        }
      }
      pageTexts.push(pageText)
      totalChars += pageText.replace(/\s+/g, '').length
    }

    const avgChars = doc.numPages > 0 ? totalChars / doc.numPages : 0

    if (avgChars < 50) {
      // 判定为扫描件，把前 4 页渲染为 PNG dataURL（scale 使宽度约 1400px）
      const images: string[] = []
      const renderCount = Math.min(doc.numPages, 4)
      for (let i = 1; i <= renderCount; i++) {
        const page = await doc.getPage(i)
        const unscaledViewport = page.getViewport({ scale: 1 })
        const scale = 1400 / (unscaledViewport.width || 1400)
        const viewport = page.getViewport({ scale })
        const canvas = document.createElement('canvas')
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        await page.render({ canvas, viewport }).promise
        images.push(canvas.toDataURL('image/png'))
      }
      return { filePath, fileName, images }
    }

    return { filePath, fileName, text: pageTexts.join('\n\n') }
  } finally {
    await doc.cleanup()
    await loadingTask.destroy()
  }
}

/**
 * 将主进程读取的文件内容 payload 转为 ExtractInput
 */
export async function fileToExtractInput(p: FilePayload): Promise<ExtractInput> {
  switch (p.kind) {
    case 'pdf':
      return pdfToExtractInput(p.base64, p.filePath, p.fileName)
    case 'image':
      return { filePath: p.filePath, fileName: p.fileName, images: [p.dataUrl] }
    case 'text':
      return { filePath: p.filePath, fileName: p.fileName, text: p.text }
    case 'unsupported':
    default:
      throw new Error(`不支持的文件类型：${p.fileName}（支持 PDF、Word(.docx)、图片、TXT）`)
  }
}
