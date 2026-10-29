import {
  Alert,
  App,
  AutoComplete,
  Button,
  Card,
  Col,
  Form,
  Input,
  Row,
  Select,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography
} from 'antd'
import {
  ApiOutlined,
  CheckCircleOutlined,
  FolderOpenOutlined,
  KeyOutlined,
  SaveOutlined,
  SettingOutlined,
  SafetyCertificateOutlined,
  SyncOutlined
} from '@ant-design/icons'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AppSettings, ModelConfig } from '@shared/types'
import { errMsg, useApp } from '../store'
import CopyButton from '../components/CopyButton'

interface ProviderPreset {
  label: string
  baseURL: string
  textModel: string
  visionModel: string
}

const PRESETS: Record<string, ProviderPreset> = {
  deepseek: {
    label: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    textModel: 'deepseek-chat',
    visionModel: 'deepseek-vl2'
  },
  qwen: {
    label: '通义千问 (DashScope)',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    textModel: 'qwen-plus',
    visionModel: 'qwen-vl-max'
  },
  kimi: {
    label: 'Kimi (Moonshot)',
    baseURL: 'https://api.moonshot.cn/v1',
    textModel: 'moonshot-v1-32k',
    visionModel: 'moonshot-v1-32k-vision-preview'
  },
  zhipu: {
    label: '智谱 GLM',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    textModel: 'glm-4-flash',
    visionModel: 'glm-4v-flash'
  },
  openai: {
    label: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    textModel: 'gpt-4o-mini',
    visionModel: 'gpt-4o'
  },
  custom: {
    label: '自定义服务商',
    baseURL: '',
    textModel: '',
    visionModel: ''
  }
}

const FALLBACK_TEXT_MODELS = [
  'deepseek-chat',
  'deepseek-reasoner',
  'qwen-plus',
  'qwen-max',
  'qwen-turbo',
  'moonshot-v1-32k',
  'moonshot-v1-128k',
  'glm-4-flash',
  'glm-4-plus',
  'gpt-4o-mini',
  'gpt-4o'
]

const FALLBACK_VISION_MODELS = [
  'deepseek-vl2',
  'deepseek-chat',
  'qwen-vl-max',
  'qwen-vl-plus',
  'moonshot-v1-32k-vision-preview',
  'glm-4v-flash',
  'glm-4v-plus',
  'gpt-4o',
  'gpt-4o-mini'
]

function isValidHttpUrl(s: string): boolean {
  return /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(s.trim())
}

export default function Settings() {
  const { message } = App.useApp()
  const { settings, refreshSettings, refresh } = useApp()

  // 文本模型表单状态
  const [textProvider, setTextProvider] = useState<string>('custom')
  const [textBaseURL, setTextBaseURL] = useState('')
  const [textModel, setTextModel] = useState('')
  const [textApiKey, setTextApiKey] = useState<string | undefined>(undefined)
  const [textModels, setTextModels] = useState<string[]>([])
  const [loadingTextModels, setLoadingTextModels] = useState(false)

  // 视觉模型表单状态
  const [visionProvider, setVisionProvider] = useState<string>('custom')
  const [visionBaseURL, setVisionBaseURL] = useState('')
  const [visionModel, setVisionModel] = useState('')
  const [visionApiKey, setVisionApiKey] = useState<string | undefined>(undefined)
  const [visionSameAsText, setVisionSameAsText] = useState(false)
  const [visionModels, setVisionModels] = useState<string[]>([])
  const [loadingVisionModels, setLoadingVisionModels] = useState(false)

  // 状态锁
  const [savingText, setSavingText] = useState(false)
  const [savingVision, setSavingVision] = useState(false)
  const [testingText, setTestingText] = useState(false)
  const [testingVision, setTestingVision] = useState(false)

  // 记录当前模型值的 ref，避免自动识别 effect 依赖 model 造成循环触发
  const textModelRef = useRef(textModel)
  textModelRef.current = textModel
  const visionModelRef = useRef(visionModel)
  visionModelRef.current = visionModel

  // 初始化加载
  useEffect(() => {
    if (!settings) {
      refreshSettings().catch((e) => message.error(errMsg(e)))
    }
  }, [settings, refreshSettings, message])

  // 同步当前设置到表单
  useEffect(() => {
    if (settings) {
      setTextBaseURL(settings.text?.baseURL ?? '')
      setTextModel(settings.text?.model ?? '')
      setVisionBaseURL(settings.vision?.baseURL ?? '')
      setVisionModel(settings.vision?.model ?? '')
      setVisionSameAsText(settings.visionSameAsText ?? false)

      const matchText = Object.entries(PRESETS).find(
        ([k, p]) => k !== 'custom' && settings.text?.baseURL?.includes(new URL(p.baseURL).hostname)
      )
      if (matchText) setTextProvider(matchText[0])

      const matchVision = Object.entries(PRESETS).find(
        ([k, p]) => k !== 'custom' && settings.vision?.baseURL?.includes(new URL(p.baseURL).hostname)
      )
      if (matchVision) setVisionProvider(matchVision[0])
    }
  }, [settings])

  // 自动识别/获取模型列表
  const detectModels = useCallback(
    async (which: 'text' | 'vision', silent = true) => {
      const isText = which === 'text'
      const url = (isText ? textBaseURL : visionBaseURL).trim()
      const keyInput = isText ? textApiKey : visionApiKey
      const hasSavedKey = isText ? settings?.text?.hasKey : settings?.vision?.hasKey

      if (!isValidHttpUrl(url)) {
        if (!silent) message.warning('请先填写有效的 Base URL（以 http:// 或 https:// 开头）')
        return
      }
      const hasEffectiveKey =
        (keyInput !== undefined && keyInput.trim().length > 0) || (keyInput === undefined && !!hasSavedKey)
      if (!hasEffectiveKey) {
        if (!silent) message.warning('请先填写 API Key')
        return
      }

      if (isText) setLoadingTextModels(true)
      else setLoadingVisionModels(true)

      try {
        const res = await window.api.listModels(which, url, keyInput)
        if (res.ok && res.models.length > 0) {
          if (isText) {
            setTextModels(res.models)
            const cur = textModelRef.current.trim()
            if (!cur || !res.models.includes(cur)) {
              setTextModel(res.recommended ?? res.models[0])
            }
          } else {
            setVisionModels(res.models)
            const cur = visionModelRef.current.trim()
            if (!cur || !res.models.includes(cur)) {
              setVisionModel(res.recommended ?? res.models[0])
            }
          }
          if (!silent) {
            message.success(`已自动识别到 ${res.models.length} 个可用模型`)
          }
        } else if (!silent) {
          message.warning(res.message || '未能从该接口获取到模型列表，可手动输入模型名称')
        }
      } catch (e) {
        if (!silent) message.error(errMsg(e))
      } finally {
        if (isText) setLoadingTextModels(false)
        else setLoadingVisionModels(false)
      }
    },
    [textBaseURL, textApiKey, visionBaseURL, visionApiKey, settings, message]
  )

  // 当用户输入/修改文本模型的 Base URL 或 API Key 时，防抖自动识别模型
  useEffect(() => {
    const hasKey =
      (textApiKey !== undefined && textApiKey.trim().length > 0) ||
      (textApiKey === undefined && !!settings?.text?.hasKey)
    if (!isValidHttpUrl(textBaseURL) || !hasKey) return
    const timer = setTimeout(() => {
      detectModels('text', true)
    }, 550)
    return () => clearTimeout(timer)
  }, [textBaseURL, textApiKey, settings?.text?.hasKey, detectModels])

  // 当用户输入/修改视觉模型的 Base URL 或 API Key 时，防抖自动识别模型
  useEffect(() => {
    if (visionSameAsText) return
    const hasKey =
      (visionApiKey !== undefined && visionApiKey.trim().length > 0) ||
      (visionApiKey === undefined && !!settings?.vision?.hasKey)
    if (!isValidHttpUrl(visionBaseURL) || !hasKey) return
    const timer = setTimeout(() => {
      detectModels('vision', true)
    }, 550)
    return () => clearTimeout(timer)
  }, [visionSameAsText, visionBaseURL, visionApiKey, settings?.vision?.hasKey, detectModels])

  // 选择文本服务商预设
  const handleSelectTextPreset = (key: string) => {
    setTextProvider(key)
    setTextModels([])
    const p = PRESETS[key]
    if (p && key !== 'custom') {
      setTextBaseURL(p.baseURL)
      setTextModel(p.textModel)
    }
  }

  // 选择视觉服务商预设
  const handleSelectVisionPreset = (key: string) => {
    setVisionProvider(key)
    setVisionModels([])
    const p = PRESETS[key]
    if (p && key !== 'custom') {
      setVisionBaseURL(p.baseURL)
      setVisionModel(p.visionModel)
    }
  }

  // 保存配置
  const saveModelConfig = async (which: 'text' | 'vision') => {
    const isText = which === 'text'
    if (isText) setSavingText(true)
    else setSavingVision(true)

    try {
      const payload: Partial<AppSettings> = {
        visionSameAsText
      }

      if (isText) {
        const conf: Partial<ModelConfig> = {
          baseURL: textBaseURL.trim(),
          model: textModel.trim()
        }
        if (textApiKey !== undefined) {
          conf.apiKey = textApiKey
        }
        payload.text = conf as ModelConfig
      } else {
        const conf: Partial<ModelConfig> = {
          baseURL: visionBaseURL.trim(),
          model: visionModel.trim()
        }
        if (visionApiKey !== undefined) {
          conf.apiKey = visionApiKey
        }
        payload.vision = conf as ModelConfig
      }

      await window.api.saveSettings(payload)
      await refreshSettings()
      if (isText) setTextApiKey(undefined)
      else setVisionApiKey(undefined)
      message.success(`${isText ? '文本' : '视觉'}模型配置已保存`)
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      if (isText) setSavingText(false)
      else setSavingVision(false)
    }
  }

  // 测试模型连接
  const testConnection = async (which: 'text' | 'vision') => {
    const isText = which === 'text'
    if (isText) setTestingText(true)
    else setTestingVision(true)

    try {
      await saveModelConfig(which)
      const res = await window.api.testConnection(which)
      if (res.ok) {
        message.success({ content: `【${isText ? '文本模型' : '视觉模型'}】${res.message}`, duration: 3 })
      } else {
        message.error({ content: `【${isText ? '文本模型' : '视觉模型'}】${res.message}`, duration: 5 })
      }
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      if (isText) setTestingText(false)
      else setTestingVision(false)
    }
  }

  // 更改数据目录
  const handleChooseDataDir = async () => {
    try {
      const newSettings = await window.api.chooseDataDir()
      if (newSettings) {
        await Promise.all([refreshSettings(), refresh()])
        message.success('已切换（若新目录为空，已复制现有数据）')
      }
    } catch (e) {
      message.error(errMsg(e))
    }
  }

  const textModelOptions = (textModels.length > 0 ? textModels : FALLBACK_TEXT_MODELS).map((m) => ({
    value: m,
    label: m
  }))
  const visionModelOptions = (visionModels.length > 0 ? visionModels : FALLBACK_VISION_MODELS).map((m) => ({
    value: m,
    label: m
  }))

  return (
    <div className="page">
      <div className="page-header">
        <h2>
          <SettingOutlined /> 设置
        </h2>
      </div>

      <Row gutter={[20, 20]}>
        {/* 文本模型 Card */}
        <Col xs={24} lg={12}>
          <Card
            title={
              <Space>
                <ApiOutlined style={{ color: '#1f4e79' }} />
                <span>文本模型（用于资料整理与文案生成）</span>
              </Space>
            }
            extra={
              <Space>
                <Button
                  size="small"
                  type="primary"
                  icon={<SaveOutlined />}
                  loading={savingText}
                  onClick={() => saveModelConfig('text')}
                >
                  保存
                </Button>
                <Button
                  size="small"
                  icon={<CheckCircleOutlined />}
                  loading={testingText}
                  onClick={() => testConnection('text')}
                >
                  测试连接
                </Button>
              </Space>
            }
          >
            <Form layout="vertical">
              <Form.Item label="服务商预设">
                <Select
                  value={textProvider}
                  onChange={handleSelectTextPreset}
                  options={Object.entries(PRESETS).map(([k, p]) => ({
                    value: k,
                    label: p.label
                  }))}
                />
              </Form.Item>

              <Form.Item label="Base URL" required tooltip="OpenAI 兼容接口地址，输入后配合 API Key 自动识别可用模型">
                <Input
                  value={textBaseURL}
                  onChange={(e) => {
                    setTextBaseURL(e.target.value)
                    setTextProvider('custom')
                  }}
                  placeholder="https://api.deepseek.com/v1"
                />
              </Form.Item>

              <Form.Item
                label={
                  <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                    <span>API Key</span>
                    {(settings?.text?.hasKey || textApiKey !== undefined) && (
                      <a
                        onClick={() => {
                          setTextApiKey('')
                          message.info('已清除 API Key，点击保存后生效')
                        }}
                        style={{ fontSize: 12 }}
                      >
                        清除已保存 Key
                      </a>
                    )}
                  </div>
                }
              >
                <Input.Password
                  value={textApiKey ?? ''}
                  onChange={(e) => setTextApiKey(e.target.value)}
                  placeholder={
                    textApiKey === ''
                      ? '已标记清除（点击保存生效）'
                      : settings?.text?.hasKey
                        ? '已保存（留空则不修改）'
                        : '请输入 API Key，输入后自动拉取可用模型'
                  }
                  prefix={<KeyOutlined style={{ color: '#bfbfbf' }} />}
                />
              </Form.Item>

              <Form.Item
                required
                label={
                  <Space size={6}>
                    <span>模型名称</span>
                    {textModels.length > 0 && <Tag color="processing">已自动识别 {textModels.length} 个模型</Tag>}
                  </Space>
                }
                tooltip="输入 Base URL 与 API Key 后会自动从服务端识别模型并填入推荐项，也可手动选择或输入"
              >
                <div style={{ display: 'flex', gap: 8 }}>
                  <AutoComplete
                    style={{ flex: 1 }}
                    value={textModel}
                    onChange={(val) => setTextModel(val)}
                    options={textModelOptions}
                    filterOption={(input, option) =>
                      (option?.value ?? '').toLowerCase().includes(input.toLowerCase())
                    }
                    placeholder="自动识别或手动输入模型名称"
                  />
                  <Tooltip title="从 Base URL 重新识别可用模型">
                    <Button
                      icon={<SyncOutlined spin={loadingTextModels} />}
                      loading={loadingTextModels}
                      onClick={() => detectModels('text', false)}
                    >
                      识别模型
                    </Button>
                  </Tooltip>
                </div>
              </Form.Item>
            </Form>
          </Card>
        </Col>

        {/* 视觉模型 Card */}
        <Col xs={24} lg={12}>
          <Card
            title={
              <Space>
                <SafetyCertificateOutlined style={{ color: '#13a8a8' }} />
                <span>视觉模型（用于识别图片与扫描件）</span>
              </Space>
            }
            extra={
              !visionSameAsText && (
                <Space>
                  <Button
                    size="small"
                    type="primary"
                    icon={<SaveOutlined />}
                    loading={savingVision}
                    onClick={() => saveModelConfig('vision')}
                  >
                    保存
                  </Button>
                  <Button
                    size="small"
                    icon={<CheckCircleOutlined />}
                    loading={testingVision}
                    onClick={() => testConnection('vision')}
                  >
                    测试连接
                  </Button>
                </Space>
              )
            }
          >
            {/* 开关：与文本模型相同 */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '8px 12px',
                background: '#fafafa',
                borderRadius: 6,
                marginBottom: 16
              }}
            >
              <div>
                <span style={{ fontWeight: 500 }}>与文本模型相同配置</span>
                <div className="muted" style={{ fontSize: 12 }}>
                  开启后将复用文本模型的 Base URL、模型及 API Key
                </div>
              </div>
              <Switch
                checked={visionSameAsText}
                onChange={async (v) => {
                  setVisionSameAsText(v)
                  await window.api.saveSettings({ visionSameAsText: v })
                  await refreshSettings()
                  message.success(v ? '已开启与文本模型相同' : '已关闭，可单独配置视觉模型')
                }}
              />
            </div>

            {visionSameAsText ? (
              <Alert
                type="info"
                showIcon
                title="已复用文本模型配置"
                description={`将使用 ${textModel || '文本模型'} 处理包含图像的资料解析任务。若需单独指定其他视觉模型，可在上方关闭开关后配置。`}
              />
            ) : (
              <Form layout="vertical">
                <Form.Item label="服务商预设">
                  <Select
                    value={visionProvider}
                    onChange={handleSelectVisionPreset}
                    options={Object.entries(PRESETS).map(([k, p]) => ({
                      value: k,
                      label: p.label
                    }))}
                  />
                </Form.Item>

                <Form.Item label="Base URL" required tooltip="支持视觉能力的 OpenAI 兼容接口地址">
                  <Input
                    value={visionBaseURL}
                    onChange={(e) => {
                      setVisionBaseURL(e.target.value)
                      setVisionProvider('custom')
                    }}
                    placeholder="https://api.deepseek.com/v1"
                  />
                </Form.Item>

                <Form.Item
                  label={
                    <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                      <span>API Key</span>
                      {(settings?.vision?.hasKey || visionApiKey !== undefined) && (
                        <a
                          onClick={() => {
                            setVisionApiKey('')
                            message.info('已清除 API Key，点击保存后生效')
                          }}
                          style={{ fontSize: 12 }}
                        >
                          清除已保存 Key
                        </a>
                      )}
                    </div>
                  }
                >
                  <Input.Password
                    value={visionApiKey ?? ''}
                    onChange={(e) => setVisionApiKey(e.target.value)}
                    placeholder={
                      visionApiKey === ''
                        ? '已标记清除（点击保存生效）'
                        : settings?.vision?.hasKey
                          ? '已保存（留空则不修改）'
                          : '请输入 API Key，输入后自动拉取可用模型'
                    }
                    prefix={<KeyOutlined style={{ color: '#bfbfbf' }} />}
                  />
                </Form.Item>

                <Form.Item
                  required
                  label={
                    <Space size={6}>
                      <span>模型名称</span>
                      {visionModels.length > 0 && <Tag color="processing">已自动识别 {visionModels.length} 个模型</Tag>}
                    </Space>
                  }
                  tooltip="输入 Base URL 与 API Key 后会自动从服务端识别视觉模型并填入推荐项"
                >
                  <div style={{ display: 'flex', gap: 8 }}>
                    <AutoComplete
                      style={{ flex: 1 }}
                      value={visionModel}
                      onChange={(val) => setVisionModel(val)}
                      options={visionModelOptions}
                      filterOption={(input, option) =>
                        (option?.value ?? '').toLowerCase().includes(input.toLowerCase())
                      }
                      placeholder="自动识别或手动输入视觉模型名称"
                    />
                    <Tooltip title="从 Base URL 重新识别可用视觉模型">
                      <Button
                        icon={<SyncOutlined spin={loadingVisionModels} />}
                        loading={loadingVisionModels}
                        onClick={() => detectModels('vision', false)}
                      >
                        识别模型
                      </Button>
                    </Tooltip>
                  </div>
                </Form.Item>
              </Form>
            )}
          </Card>
        </Col>

        {/* 数据存储 Card */}
        <Col span={24}>
          <Card
            title={
              <Space>
                <FolderOpenOutlined style={{ color: '#fa8c16' }} />
                <span>数据存储与目录</span>
              </Space>
            }
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <span className="muted" style={{ marginRight: 8 }}>
                  当前数据存储路径：
                </span>
                <Typography.Text code copyable={false} style={{ fontSize: 13, wordBreak: 'break-all' }}>
                  {settings?.dataDir || '未加载…'}
                </Typography.Text>
              </div>
              <Space>
                {settings?.dataDir && <CopyButton text={settings.dataDir} label="复制路径" size="middle" />}
                <Button type="primary" onClick={handleChooseDataDir}>
                  更改目录
                </Button>
              </Space>
            </div>
          </Card>
        </Col>
      </Row>

      {/* 隐私说明 Alert */}
      <Alert
        type="info"
        showIcon
        title="隐私说明与安全保障"
        description="所有个人画像数据（包含基本信息、经历条目与证明附件）仅保存在本机；仅在使用 AI 整理或文案生成功能时，才将必要文本与所选图片发送给您所配置的模型服务商；身份证号等被标记为敏感的字段在调用 AI 时均被过滤排除，绝不上传；所有 API Key 均使用系统级安全密钥库加密存储。"
        style={{ marginTop: 20 }}
      />
    </div>
  )
}
