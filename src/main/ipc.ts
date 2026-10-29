import fs from 'fs'
import path from 'path'
import { BrowserWindow, dialog, ipcMain, screen, shell } from 'electron'
import type { Api, AiStreamEvent, FilePayload } from '@shared/ipc'
import { AI_STREAM_CHANNEL, API_METHODS } from '@shared/ipc'
import type { AppSettings } from '@shared/types'
import { Store, mimeOf } from './services/store'
import { SettingsService } from './services/settings'
import { fetchModels, pickRecommendedModel, testConnection } from './services/ai/client'
import { extractFromInputs, organizeText } from './services/ai/extract'
import { batchFillForm, deAiResumePreview, generateStream, polishFieldText } from './services/ai/generate'
import { analyzeDocForFill, saveDocFillAnswers, writeFilledDoc } from './services/docfill'
import { buildResumeHtml } from './services/export/resumeHtml'
import { htmlToPdf } from './services/export/pdf'
import { buildResumeDocx } from './services/export/docx'
import { createBackup, exportProofsZip, restoreBackup } from './services/export/backup'
import { extractDocxText } from './services/parse'

const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif']
const TEXT_EXT = ['.txt', '.md', '.json', '.csv']

export function registerIpc(getWin: () => BrowserWindow | null): void {
  const settings = new SettingsService()
  let store = new Store(settings.dataDir)
  const aborts = new Map<string, AbortController>()

  let isMini = false
  let savedBounds: Electron.Rectangle | null = null

  const send = (e: AiStreamEvent) => getWin()?.webContents.send(AI_STREAM_CHANNEL, e)
  const stamp = () => new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const saveDialog = async (defaultName: string, ext: string, label: string) => {
    const r = await dialog.showSaveDialog(getWin()!, { defaultPath: defaultName, filters: [{ name: label, extensions: [ext] }] })
    return r.canceled || !r.filePath ? null : r.filePath
  }
  const profileName = () => String(store.getDb().profile.data.name ?? '我')

  const handlers: Api = {
    // ---- 数据 ----
    getDb: async () => store.getDb(),
    saveProfile: async (data) => store.saveProfile(data),
    upsertEntry: async (e) => store.upsertEntry(e),
    deleteEntry: async (id) => store.deleteEntry(id),
    reorderEntries: async (c, ids) => store.reorderEntries(c, ids),
    saveSchema: async (s) => store.saveSchema(s),
    commitCandidates: async (list, patch) => store.commitCandidates(list, patch),
    saveSnippet: async (s) => store.saveSnippet(s),
    deleteSnippet: async (id) => store.deleteSnippet(id),
    mergeEntries: async (primaryId, secondaryId, fieldOverrides) =>
      store.mergeEntries(primaryId, secondaryId, fieldOverrides),
    listSnapshots: async () => store.listSnapshotMetas(),
    createSnapshot: async () => store.createSnapshotNow(),
    restoreSnapshot: async (snapshotId) => store.restoreSnapshot(snapshotId),

    // ---- 文件 ----
    pickFiles: async (opts) => {
      const filters = opts?.images
        ? [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'] }]
        : opts?.docs
          ? [
              { name: '文档与图片', extensions: ['pdf', 'docx', 'txt', 'md', 'png', 'jpg', 'jpeg', 'webp', 'bmp'] },
              { name: '所有文件', extensions: ['*'] }
            ]
          : [{ name: '所有文件', extensions: ['*'] }]
      const r = await dialog.showOpenDialog(getWin()!, {
        properties: opts?.multi === false ? ['openFile'] : ['openFile', 'multiSelections'],
        filters
      })
      return r.canceled ? [] : r.filePaths
    },
    addAttachments: async (t, paths) => store.addAttachments(t, paths),
    addAttachmentFromBase64: async (t, dataUrl, fileName) => store.addAttachmentFromBase64(t, dataUrl, fileName),
    removeAttachment: async (t, id) => store.removeAttachment(t, id),
    openAttachment: async (rel) => {
      const err = await shell.openPath(store.abs(rel))
      if (err) throw new Error(err)
    },
    showAttachmentInFolder: async (rel) => shell.showItemInFolder(store.abs(rel)),
    attachmentDataUrl: async (rel) => {
      const abs = store.abs(rel)
      if (!fs.existsSync(abs) || fs.statSync(abs).size > 15 * 1024 * 1024) return null
      return `data:${mimeOf(abs)};base64,${fs.readFileSync(abs).toString('base64')}`
    },
    setAvatar: async (filePath) => {
      if (!filePath) return store.setAvatar(undefined)
      const { relPath } = store.importFile(filePath, '_avatar')
      return store.setAvatar(relPath)
    },
    readFileForParse: async (filePath): Promise<FilePayload> => {
      const fileName = path.basename(filePath)
      const ext = path.extname(filePath).toLowerCase()
      const size = fs.statSync(filePath).size
      if (size > 30 * 1024 * 1024) throw new Error(`文件过大（>30MB）：${fileName}`)
      if (ext === '.pdf') return { kind: 'pdf', fileName, filePath, base64: fs.readFileSync(filePath).toString('base64') }
      if (IMAGE_EXT.includes(ext))
        return { kind: 'image', fileName, filePath, dataUrl: `data:${mimeOf(filePath)};base64,${fs.readFileSync(filePath).toString('base64')}` }
      if (ext === '.docx') return { kind: 'text', fileName, filePath, text: await extractDocxText(filePath) }
      if (TEXT_EXT.includes(ext)) return { kind: 'text', fileName, filePath, text: fs.readFileSync(filePath, 'utf-8') }
      return { kind: 'unsupported', fileName, filePath }
    },

    // ---- 窗口 / 设置 ----
    getSettings: async () => settings.getPublic(),
    saveSettings: async (s) => settings.save(s),
    chooseDataDir: async (): Promise<AppSettings | null> => {
      const r = await dialog.showOpenDialog(getWin()!, { properties: ['openDirectory', 'createDirectory'], title: '选择数据存放目录' })
      if (r.canceled || !r.filePaths[0]) return null
      const dir = r.filePaths[0]
      const hasData = fs.existsSync(path.join(dir, 'db.json'))
      if (!hasData) {
        fs.cpSync(store.dataDir, dir, { recursive: true })
      }
      const res = settings.save({ dataDir: dir })
      store = new Store(dir)
      return res
    },
    getMiniMode: async () => isMini,
    setMiniMode: async (enabled: boolean) => {
      const w = getWin()
      if (!w) return isMini
      if (enabled && !isMini) {
        if (w.isMaximized()) w.unmaximize()
        savedBounds = w.getBounds()
        const area = screen.getPrimaryDisplay().workArea
        const miniWidth = 400
        const miniHeight = Math.min(760, area.height - 60)
        w.setMinimumSize(340, 460)
        w.setBounds({
          x: Math.max(area.x, area.x + area.width - miniWidth - 16),
          y: area.y + 30,
          width: miniWidth,
          height: miniHeight
        })
        w.setAlwaysOnTop(true, 'floating')
        isMini = true
      } else if (!enabled && isMini) {
        w.setAlwaysOnTop(false)
        w.setMinimumSize(1000, 640)
        if (savedBounds) {
          w.setBounds(savedBounds)
        } else {
          w.setSize(1280, 820)
          w.center()
        }
        isMini = false
      }
      return isMini
    },

    // ---- AI ----
    listModels: async (which, baseURL, apiKey) => {
      try {
        const key = settings.resolveApiKey(which, apiKey)
        const models = await fetchModels(baseURL, key)
        return {
          ok: true,
          models,
          recommended: pickRecommendedModel(models, which === 'vision')
        }
      } catch (e) {
        return { ok: false, models: [], message: (e as Error).message }
      }
    },
    testConnection: async (which) => {
      try {
        return await testConnection(settings.resolve(which), which === 'vision')
      } catch (e) {
        return { ok: false, message: (e as Error).message }
      }
    },
    extractFromInputs: async (inputs) => extractFromInputs((w) => settings.resolve(w), inputs, store.getDb()),
    organizeText: async (text, hint) => organizeText(settings.resolve('text'), text, hint, store.getDb()),
    generateText: async (requestId, req) => {
      const ac = new AbortController()
      aborts.set(requestId, ac)
      try {
        await generateStream(settings.resolve('text'), req, store.getDb(), (t) => send({ requestId, type: 'delta', text: t }), ac.signal)
        send({ requestId, type: 'done' })
      } catch (e) {
        if (ac.signal.aborted) send({ requestId, type: 'done' })
        else send({ requestId, type: 'error', message: (e as Error).message })
      } finally {
        aborts.delete(requestId)
      }
    },
    cancelGenerate: async (requestId) => aborts.get(requestId)?.abort(),
    batchFillForm: async (req) => batchFillForm((w) => settings.resolve(w), req, store.getDb()),
    polishFieldText: async (req) => polishFieldText(settings.resolve('text'), req),
    analyzeDocForFill: async (filePath) =>
      analyzeDocForFill(settings.resolve('text'), filePath, store.getDb(), (rel) => store.abs(rel)),
    saveDocFillAnswers: async (answers) => saveDocFillAnswers(store, answers),
    writeFilledDoc: async (req) => {
      const rel = store.getDb().profile?.avatarRelPath
      const avatarAbs = rel ? store.abs(rel) : undefined
      return writeFilledDoc(req, avatarAbs)
    },
    chooseSavePath: async (defaultPath) => {
      const ext = path.extname(defaultPath).replace(/^\./, '') || 'docx'
      const r = await dialog.showSaveDialog(getWin()!, {
        defaultPath,
        filters: [{ name: `${ext.toUpperCase()} 文件`, extensions: [ext] }, { name: '所有文件', extensions: ['*'] }]
      })
      return r.canceled || !r.filePath ? null : r.filePath
    },
    deAiResumePreview: async (entryIds) =>
      deAiResumePreview(settings.resolve('text'), store.getDb(), entryIds),
    applyDeAiPatches: async (patches) => {
      const db = store.getDb()
      let profileUpdated = false
      const profileData = { ...(db.profile?.data ?? {}) }
      const entryUpdates = new Map<string, Record<string, unknown>>()

      for (const p of patches) {
        if (!p.revised || !p.revised.trim()) continue
        if (p.targetType === 'profile') {
          profileData[p.fieldKey] = p.revised.trim()
          profileUpdated = true
        } else if (p.targetType === 'entry' && p.entryId) {
          const existing = db.entries.find((e) => e.id === p.entryId)
          if (!existing) continue
          const curData = entryUpdates.get(p.entryId) ?? { ...existing.data }
          curData[p.fieldKey] = p.revised.trim()
          entryUpdates.set(p.entryId, curData)
        }
      }

      if (profileUpdated) {
        store.saveProfile(profileData)
      }
      for (const [entryId, newData] of entryUpdates.entries()) {
        const existing = db.entries.find((e) => e.id === entryId)
        if (existing) {
          store.upsertEntry({
            id: entryId,
            category: existing.category,
            data: newData,
            tags: existing.tags
          })
        }
      }
    },

    // ---- 导出 ----
    resumeHtml: async (opts) => buildResumeHtml(store.getDb(), opts, (rel) => store.abs(rel)),
    exportResumePdf: async (opts) => {
      const out = await saveDialog(`${profileName()}-简历.pdf`, 'pdf', 'PDF')
      if (!out) return null
      await htmlToPdf(buildResumeHtml(store.getDb(), opts, (rel) => store.abs(rel)), out)
      return out
    },
    exportResumeDocx: async (opts) => {
      const out = await saveDialog(`${profileName()}-简历.docx`, 'docx', 'Word 文档')
      if (!out) return null
      fs.writeFileSync(out, await buildResumeDocx(store.getDb(), opts, (rel) => store.abs(rel)))
      return out
    },
    exportProofsBundle: async (opts) => {
      const out = await saveDialog(`${profileName()}-证明材料汇总_${stamp()}.zip`, 'zip', 'ZIP 压缩包')
      if (!out) return null
      const res = exportProofsZip(store.getDb(), opts, (rel) => store.abs(rel), out)
      return { outPath: out, ...res }
    },
    backupZip: async () => {
      const out = await saveDialog(`个人画像备份_${stamp()}.zip`, 'zip', 'ZIP')
      if (!out) return null
      createBackup(store.dataDir, out)
      return out
    },
    restoreZip: async () => {
      const r = await dialog.showOpenDialog(getWin()!, { properties: ['openFile'], filters: [{ name: 'ZIP', extensions: ['zip'] }] })
      if (r.canceled || !r.filePaths[0]) return false
      const ok = await dialog.showMessageBox(getWin()!, {
        type: 'warning',
        buttons: ['取消', '恢复'],
        defaultId: 1,
        cancelId: 0,
        message: '恢复会覆盖当前全部资料',
        detail: '恢复前会自动把当前数据备份到数据目录下的 auto-backups 文件夹。'
      })
      if (ok.response !== 1) return false
      const autoDir = path.join(store.dataDir, 'auto-backups')
      fs.mkdirSync(autoDir, { recursive: true })
      createBackup(store.dataDir, path.join(autoDir, `恢复前_${Date.now()}.zip`))
      restoreBackup(r.filePaths[0], store.dataDir)
      store.reload()
      return true
    },
    openExternalPath: async (absPath, revealInFolder) => {
      if (revealInFolder) {
        shell.showItemInFolder(absPath)
      } else {
        const err = await shell.openPath(absPath)
        if (err) throw new Error(err)
      }
    }
  }

  for (const m of API_METHODS) {
    const fn = handlers[m] as (...args: unknown[]) => Promise<unknown>
    ipcMain.handle(m, async (_e, ...args) => fn(...args))
  }
}
