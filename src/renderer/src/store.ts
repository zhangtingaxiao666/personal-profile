import { create } from 'zustand'
import type { AppSettings, CategoryDef, Database } from '@shared/types'
import { resolveCategories, resolveProfileCategory } from '@shared/categories'

interface AppState {
  db: Database | null
  settings: AppSettings | null
  categories: CategoryDef[]
  visibleCategories: CategoryDef[]
  profileDef: CategoryDef | null
  miniMode: boolean
  /** AI 导入后台运行状态与待审核数量（跨页面保持） */
  aiImportBusy: boolean
  aiImportPendingCount: number
  setAiImportStatus: (busy: boolean, pendingCount?: number) => void
  /** 快速填表后台运行状态与待填项数量（跨页面保持） */
  quickFillBusy: boolean
  quickFillPendingCount: number
  setQuickFillStatus: (busy: boolean, pendingCount?: number) => void
  /** 从主进程重新加载全部数据 */
  refresh: () => Promise<void>
  refreshSettings: () => Promise<void>
  toggleMiniMode: (enabled?: boolean) => Promise<boolean>
}

export const useApp = create<AppState>((set, get) => ({
  db: null,
  settings: null,
  categories: [],
  visibleCategories: [],
  profileDef: null,
  miniMode: false,
  aiImportBusy: false,
  aiImportPendingCount: 0,
  setAiImportStatus: (busy, pendingCount) =>
    set((s) => ({
      aiImportBusy: busy,
      aiImportPendingCount: pendingCount !== undefined ? pendingCount : s.aiImportPendingCount
    })),
  quickFillBusy: false,
  quickFillPendingCount: 0,
  setQuickFillStatus: (busy, pendingCount) =>
    set((s) => ({
      quickFillBusy: busy,
      quickFillPendingCount: pendingCount !== undefined ? pendingCount : s.quickFillPendingCount
    })),
  refresh: async () => {
    const db = await window.api.getDb()
    const categories = resolveCategories(db.schema)
    set({
      db,
      categories,
      visibleCategories: categories.filter((c) => !c.hidden),
      profileDef: resolveProfileCategory(db.schema)
    })
  },
  refreshSettings: async () => {
    const [settings, miniMode] = await Promise.all([window.api.getSettings(), window.api.getMiniMode()])
    set({ settings, miniMode })
  },
  toggleMiniMode: async (enabled?: boolean) => {
    const target = enabled ?? !get().miniMode
    const next = await window.api.setMiniMode(target)
    set({ miniMode: next })
    return next
  }
}))

/** 获取可见分类（稳定引用，适配 React 19 useSyncExternalStore） */
export const useVisibleCategories = () => useApp((s) => s.visibleCategories)

/** 去掉 Electron IPC 错误前缀 */
export function errMsg(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  return m.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
