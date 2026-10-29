import fs from 'fs'
import path from 'path'
import os from 'os'
import { randomUUID } from 'crypto'
import { BrowserWindow } from 'electron'

export async function htmlToPdf(html: string, outPath: string): Promise<void> {
  const tmpFile = path.join(os.tmpdir(), `resume_${randomUUID()}.html`)
  fs.writeFileSync(tmpFile, html, 'utf-8')

  let win: BrowserWindow | null = null
  try {
    win = new BrowserWindow({
      show: false,
      webPreferences: {
        offscreen: false,
        javascript: true
      }
    })

    await new Promise<void>((resolve, reject) => {
      win!.webContents.once('did-finish-load', () => resolve())
      win!.webContents.once('did-fail-load', (_event, errorCode, errorDescription) => {
        reject(new Error(`HTML加载失败: ${errorDescription} (${errorCode})`))
      })
      win!.loadFile(tmpFile).catch(reject)
    })

    await win.webContents.executeJavaScript(`
      Promise.all([
        document.fonts ? document.fonts.ready : Promise.resolve(),
        Promise.all(
          Array.from(document.images)
            .filter(img => !img.complete)
            .map(img => new Promise(resolve => {
              img.onload = img.onerror = resolve
            }))
        )
      ])
    `)

    const pdfBuffer = await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      preferCSSPageSize: true
    })

    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    fs.writeFileSync(outPath, pdfBuffer)
  } finally {
    if (win && !win.isDestroyed()) {
      win.close()
    }
    try {
      if (fs.existsSync(tmpFile)) {
        fs.unlinkSync(tmpFile)
      }
    } catch {
      // ignore
    }
  }
}
