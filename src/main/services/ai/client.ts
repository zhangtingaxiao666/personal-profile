import type { ResolvedModel } from '../settings'

export type ChatMessageContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | ChatMessageContentPart[]
}

const TINY_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

function parseErrorMessage(bodyText: string): string {
  try {
    const json = JSON.parse(bodyText)
    if (json?.error?.message && typeof json.error.message === 'string') {
      return json.error.message
    }
    if (json?.message && typeof json.message === 'string') {
      return json.message
    }
  } catch {
    // 非 JSON 格式
  }
  return bodyText.trim()
}

function createFriendlyError(status: number, rawMsg: string): Error {
  const snippet = rawMsg ? rawMsg.slice(0, 200) : ''
  const withSnippet = (prefix: string) => (snippet ? `${prefix}：${snippet}` : prefix)

  if (/image|vision|multimodal/i.test(rawMsg)) {
    return new Error(withSnippet('该模型不支持图片输入，请在设置中配置视觉模型'))
  }
  if (status === 401 || status === 403) {
    return new Error(withSnippet('API Key 无效或无权限'))
  }
  if (status === 402 || /insufficient|余额/i.test(rawMsg)) {
    return new Error(withSnippet('账户余额不足'))
  }
  if (status === 404) {
    return new Error(withSnippet('接口地址或模型名称错误'))
  }
  if (status === 429) {
    return new Error(withSnippet('请求过于频繁或额度已用完'))
  }

  return new Error(withSnippet(`请求失败 (${status})`))
}

function handleFetchError(err: unknown, baseURL: string, signal?: AbortSignal): never {
  if (signal?.aborted) {
    throw err
  }
  if (err instanceof Error && err.name === 'AbortError') {
    throw err
  }
  const original = err instanceof Error ? err.message : String(err)
  throw new Error(`无法连接到 ${baseURL}，请检查网络或 Base URL：${original.slice(0, 200)}`)
}

export async function chat(
  m: ResolvedModel,
  messages: ChatMessage[],
  opts?: {
    json?: boolean
    temperature?: number
    signal?: AbortSignal
    timeoutMs?: number
    max_tokens?: number
  }
): Promise<string> {
  const timeoutMs = opts?.timeoutMs ?? 120000
  const timeoutSignal = AbortSignal.timeout(timeoutMs)
  const combinedSignal = opts?.signal ? AbortSignal.any([opts.signal, timeoutSignal]) : timeoutSignal

  const body: Record<string, unknown> = {
    model: m.model,
    messages
  }
  if (opts?.temperature !== undefined) {
    body.temperature = opts.temperature
  }
  if (opts?.max_tokens !== undefined) {
    body.max_tokens = opts.max_tokens
  }
  if (opts?.json) {
    body.response_format = { type: 'json_object' }
  }

  let res: Response
  try {
    res = await fetch(`${m.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${m.apiKey}`
      },
      body: JSON.stringify(body),
      signal: combinedSignal
    })
  } catch (err) {
    handleFetchError(err, m.baseURL, combinedSignal)
  }

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '')
    // 若服务端返回 400 且错误信息涉及 response_format，则去掉该参数自动重试一次
    if (res.status === 400 && opts?.json && /response_format/i.test(bodyText)) {
      return chat(m, messages, { ...opts, json: false })
    }
    const rawMsg = parseErrorMessage(bodyText)
    throw createFriendlyError(res.status, rawMsg)
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>
  }
  return data?.choices?.[0]?.message?.content ?? ''
}

export async function chatStream(
  m: ResolvedModel,
  messages: ChatMessage[],
  onDelta: (t: string) => void,
  opts?: { temperature?: number; signal?: AbortSignal }
): Promise<string> {
  const body: Record<string, unknown> = {
    model: m.model,
    messages,
    stream: true
  }
  if (opts?.temperature !== undefined) {
    body.temperature = opts.temperature
  }

  let res: Response
  try {
    res = await fetch(`${m.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${m.apiKey}`
      },
      body: JSON.stringify(body),
      signal: opts?.signal
    })
  } catch (err) {
    handleFetchError(err, m.baseURL, opts?.signal)
  }

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '')
    const rawMsg = parseErrorMessage(bodyText)
    throw createFriendlyError(res.status, rawMsg)
  }

  if (!res.body) {
    return ''
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder('utf-8')
  let buffer = ''
  let fullText = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const rawLine of lines) {
        const line = rawLine.trim()
        if (!line || line.startsWith(':')) continue
        if (line === 'data: [DONE]' || line === 'data:[DONE]') continue
        if (line.startsWith('data:')) {
          const jsonStr = line.slice(5).trim()
          if (jsonStr === '[DONE]') continue
          try {
            const parsed = JSON.parse(jsonStr) as {
              choices?: Array<{ delta?: { content?: string } }>
            }
            const delta = parsed?.choices?.[0]?.delta?.content
            if (typeof delta === 'string' && delta.length > 0) {
              fullText += delta
              onDelta(delta)
            }
          } catch {
            // 忽略非完整/格式异常数据行
          }
        }
      }
    }

    if (buffer.trim()) {
      const line = buffer.trim()
      if (line.startsWith('data:')) {
        const jsonStr = line.slice(5).trim()
        if (jsonStr !== '[DONE]') {
          try {
            const parsed = JSON.parse(jsonStr) as {
              choices?: Array<{ delta?: { content?: string } }>
            }
            const delta = parsed?.choices?.[0]?.delta?.content
            if (typeof delta === 'string' && delta.length > 0) {
              fullText += delta
              onDelta(delta)
            }
          } catch {
            // 忽略
          }
        }
      }
    }
  } catch (err) {
    handleFetchError(err, m.baseURL, opts?.signal)
  }

  return fullText
}

export async function testConnection(
  m: ResolvedModel,
  vision: boolean
): Promise<{ ok: boolean; message: string }> {
  try {
    const messages: ChatMessage[] = vision
      ? [
          {
            role: 'user',
            content: [
              { type: 'text', text: '回复OK' },
              { type: 'image_url', image_url: { url: TINY_PNG_DATA_URL } }
            ]
          }
        ]
      : [{ role: 'user', content: '回复OK' }]

    await chat(m, messages, { timeoutMs: 15000, max_tokens: 16 })
    return { ok: true, message: `连接成功，模型：${m.model}` }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

const NON_CHAT_MODEL_RE =
  /^(text-embedding|embedding|babbage|davinci-002|tts-|whisper-|dall-e-|omni-moderation|text-moderation|rerank)/i

/** 从兼容 OpenAI 的 /models 端点获取可用模型列表 */
export async function fetchModels(baseURL: string, apiKey: string): Promise<string[]> {
  const cleanUrl = baseURL.trim().replace(/\/+$/, '')
  if (!cleanUrl) throw new Error('请先填写 Base URL')
  if (!apiKey.trim()) throw new Error('请先填写 API Key')

  const timeoutSignal = AbortSignal.timeout(12000)
  let res: Response
  try {
    res = await fetch(`${cleanUrl}/models`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`
      },
      signal: timeoutSignal
    })
  } catch (err) {
    handleFetchError(err, cleanUrl, timeoutSignal)
  }

  if (!res.ok) {
    const bodyText = await res.text().catch(() => '')
    const rawMsg = parseErrorMessage(bodyText)
    throw createFriendlyError(res.status, rawMsg)
  }

  const json = (await res.json()) as unknown
  let rawItems: unknown[] = []
  if (Array.isArray(json)) {
    rawItems = json
  } else if (json && typeof json === 'object') {
    const obj = json as Record<string, unknown>
    if (Array.isArray(obj.data)) rawItems = obj.data
    else if (Array.isArray(obj.models)) rawItems = obj.models
  }

  const ids: string[] = []
  for (const item of rawItems) {
    if (typeof item === 'string' && item.trim()) {
      ids.push(item.trim())
    } else if (item && typeof item === 'object') {
      const rec = item as Record<string, unknown>
      const id = typeof rec.id === 'string' ? rec.id : typeof rec.name === 'string' ? rec.name : ''
      if (id.trim()) ids.push(id.trim())
    }
  }

  const unique = [...new Set(ids)]
  const filtered = unique.filter((id) => !NON_CHAT_MODEL_RE.test(id))
  return filtered.length > 0 ? filtered : unique
}

const VISION_PRIORITY_PATTERNS: RegExp[] = [
  /deepseek.*(vl|vision|multimodal|janus)/i,
  /qwen.*vl.*(max|plus)/i,
  /^gpt-4o$/i,
  /gpt-4o/i,
  /glm-4v/i,
  /moonshot.*vision|kimi.*(vl|vision|latest)/i,
  /claude-3|gemini.*(flash|pro)|vl|vision|multimodal|pixtral|qvq/i,
  /^deepseek-chat$/i
]

const TEXT_PRIORITY_PATTERNS: RegExp[] = [
  /^deepseek-chat$/i,
  /deepseek-v3|deepseek-chat/i,
  /^qwen-plus$/i,
  /^qwen-max$/i,
  /qwen.*(plus|max|turbo)/i,
  /^gpt-4o-mini$/i,
  /^gpt-4o$/i,
  /^glm-4-flash$/i,
  /^glm-4-plus$/i,
  /moonshot-v1-32k|kimi-latest|moonshot/i,
  /claude.*sonnet|gemini.*flash/i
]

/** 从模型列表中智能挑选推荐的文本或视觉模型 */
export function pickRecommendedModel(models: string[], vision: boolean): string | undefined {
  if (models.length === 0) return undefined
  const patterns = vision ? VISION_PRIORITY_PATTERNS : TEXT_PRIORITY_PATTERNS
  for (const re of patterns) {
    const hit = models.find((m) => re.test(m))
    if (hit) return hit
  }
  return models[0]
}

