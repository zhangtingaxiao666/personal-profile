import fs from 'fs'
import path from 'path'
import { app, safeStorage } from 'electron'
import type { AppSettings, ModelConfig } from '@shared/types'

/** 已解析的模型配置（含明文 key，仅主进程内部使用） */
export interface ResolvedModel {
  baseURL: string
  model: string
  apiKey: string
}

interface StoredModel {
  baseURL: string
  model: string
  /** safeStorage 加密后的 base64；不可用时为 'plain:' 前缀 */
  encKey?: string
}

interface StoredSettings {
  dataDir: string
  text: StoredModel
  vision: StoredModel
  visionSameAsText: boolean
}

const CANONICAL_APP_FOLDER = '个人画像'
/** 历史版本因编码差异可能产生的旧目录名 */
const LEGACY_FOLDER_NAMES = [
  String.fromCharCode(28051, 57411, 27721, 37922, 35826, 20762),
  'personal-profile',
  'PersonalProfile'
]

function getDbRichness(dbFilePath: string): number {
  try {
    if (!fs.existsSync(dbFilePath)) return -1
    const raw = JSON.parse(fs.readFileSync(dbFilePath, 'utf-8'))
    const entryCount = Array.isArray(raw?.entries) ? raw.entries.length : 0
    const profileKeyCount = raw?.profile?.data ? Object.keys(raw.profile.data).length : 0
    const snippetCount = Array.isArray(raw?.snippets) ? raw.snippets.length : 0
    return entryCount * 10 + profileKeyCount + snippetCount * 2
  } catch {
    return -1
  }
}

/**
 * 统一并迁移历史目录数据：
 * 确保无论开发模式、免安装版还是安装包更新，始终使用固定目录 %APPDATA%/个人画像，
 * 且自动把旧目录中已填写的资料与附件完整迁移过来，防止程序修改或重装导致数据遗失。
 */
export function ensureUnifiedUserDataDir(): string {
  const appData = app.getPath('appData')
  const canonicalDir = path.join(appData, CANONICAL_APP_FOLDER)
  const canonicalDataDir = path.join(canonicalDir, 'data')
  const canonicalSettingsFile = path.join(canonicalDir, 'settings.json')
  const canonicalDbFile = path.join(canonicalDataDir, 'db.json')

  fs.mkdirSync(canonicalDataDir, { recursive: true })

  const canonicalScore = getDbRichness(canonicalDbFile)

  for (const legacyName of LEGACY_FOLDER_NAMES) {
    if (legacyName === CANONICAL_APP_FOLDER) continue
    const legacyDir = path.join(appData, legacyName)
    if (!fs.existsSync(legacyDir)) continue

    const legacySettingsFile = path.join(legacyDir, 'settings.json')
    const legacyDataDir = path.join(legacyDir, 'data')
    const legacyDbFile = path.join(legacyDataDir, 'db.json')

    // 1. 迁移 settings.json（若标准目录尚无 settings.json）
    if (!fs.existsSync(canonicalSettingsFile) && fs.existsSync(legacySettingsFile)) {
      try {
        fs.copyFileSync(legacySettingsFile, canonicalSettingsFile)
      } catch {
        // ignore
      }
    }

    // 2. 若旧目录中的 db.json 含有更多已填写数据，迁移 data 目录（含 db.json, attachments, snapshots）
    const legacyScore = getDbRichness(legacyDbFile)
    if (legacyScore > 0 && legacyScore > canonicalScore) {
      try {
        fs.cpSync(legacyDataDir, canonicalDataDir, { recursive: true, force: true })
      } catch {
        // ignore
      }
    }
  }

  return canonicalDir
}

const defaults = (baseUserDataDir: string): StoredSettings => ({
  dataDir: path.join(baseUserDataDir, 'data'),
  text: { baseURL: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  vision: { baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-vl-max' },
  visionSameAsText: false
})

function encrypt(key: string): string {
  if (safeStorage.isEncryptionAvailable()) return safeStorage.encryptString(key).toString('base64')
  return 'plain:' + Buffer.from(key, 'utf-8').toString('base64')
}
function decrypt(enc?: string): string {
  if (!enc) return ''
  try {
    if (enc.startsWith('plain:')) return Buffer.from(enc.slice(6), 'base64').toString('utf-8')
    return safeStorage.decryptString(Buffer.from(enc, 'base64'))
  } catch {
    return ''
  }
}

export class SettingsService {
  private baseDir: string
  private file: string
  private s: StoredSettings

  constructor() {
    this.baseDir = ensureUnifiedUserDataDir()
    this.file = path.join(this.baseDir, 'settings.json')
    this.s = defaults(this.baseDir)
    try {
      if (fs.existsSync(this.file)) {
        const raw = JSON.parse(fs.readFileSync(this.file, 'utf-8'))
        this.s = {
          ...this.s,
          ...raw,
          text: { ...this.s.text, ...raw.text },
          vision: { ...this.s.vision, ...raw.vision }
        }
        // 若旧配置的 dataDir 指向历史乱码目录，自动修正到统一目录（数据已在 ensureUnifiedUserDataDir 迁移）
        for (const legacyName of LEGACY_FOLDER_NAMES) {
          if (this.s.dataDir && this.s.dataDir.includes(legacyName)) {
            this.s.dataDir = path.join(this.baseDir, 'data')
            this.persist()
            break
          }
        }
      }
    } catch {
      /* 使用默认 */
    }
  }

  private persist() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = this.file + '.tmp'
    fs.writeFileSync(tmp, JSON.stringify(this.s, null, 2), 'utf-8')
    fs.renameSync(tmp, this.file)
  }

  get dataDir(): string {
    return this.s.dataDir
  }

  /** 返回给渲染进程的设置（不含明文 key） */
  getPublic(): AppSettings {
    const pub = (m: StoredModel): ModelConfig => ({ baseURL: m.baseURL, model: m.model, hasKey: !!m.encKey })
    return { dataDir: this.s.dataDir, text: pub(this.s.text), vision: pub(this.s.vision), visionSameAsText: this.s.visionSameAsText }
  }

  save(patch: Partial<AppSettings>): AppSettings {
    const apply = (cur: StoredModel, m?: ModelConfig): StoredModel => {
      if (!m) return cur
      const next: StoredModel = { ...cur, baseURL: m.baseURL?.trim() ?? cur.baseURL, model: m.model?.trim() ?? cur.model }
      // apiKey: undefined = 不修改；'' = 清除
      if (m.apiKey !== undefined) next.encKey = m.apiKey ? encrypt(m.apiKey.trim()) : undefined
      return next
    }
    this.s = {
      ...this.s,
      dataDir: patch.dataDir ?? this.s.dataDir,
      visionSameAsText: patch.visionSameAsText ?? this.s.visionSameAsText,
      text: apply(this.s.text, patch.text),
      vision: apply(this.s.vision, patch.vision)
    }
    this.persist()
    return this.getPublic()
  }

  resolveApiKey(which: 'text' | 'vision', inputKey?: string): string {
    if (inputKey !== undefined) return inputKey.trim()
    const m = which === 'vision' && !this.s.visionSameAsText ? this.s.vision : this.s.text
    return decrypt(m.encKey)
  }

  resolve(which: 'text' | 'vision'): ResolvedModel {
    const m = which === 'vision' && !this.s.visionSameAsText ? this.s.vision : this.s.text
    const apiKey = decrypt(m.encKey)
    if (!apiKey) throw new Error(`尚未配置${which === 'vision' ? '视觉' : '文本'}模型的 API Key，请到「设置」中填写`)
    if (!m.baseURL || !m.model) throw new Error('模型 Base URL 或模型名称为空，请到「设置」中填写')
    return { baseURL: m.baseURL.replace(/\/+$/, ''), model: m.model, apiKey }
  }
}
