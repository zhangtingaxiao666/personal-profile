import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { AI_STREAM_CHANNEL, API_METHODS } from '../shared/ipc'
import type { AiStreamEvent, WindowApi } from '../shared/ipc'

const api: Record<string, unknown> = {}
for (const m of API_METHODS) {
  api[m] = (...args: unknown[]) => ipcRenderer.invoke(m, ...args)
}
api.onAiStream = (cb: (e: AiStreamEvent) => void) => {
  const listener = (_: unknown, e: AiStreamEvent) => cb(e)
  ipcRenderer.on(AI_STREAM_CHANNEL, listener)
  return () => ipcRenderer.removeListener(AI_STREAM_CHANNEL, listener)
}
api.getPathForFile = (file: File) => webUtils.getPathForFile(file)

contextBridge.exposeInMainWorld('api', api as unknown as WindowApi)
