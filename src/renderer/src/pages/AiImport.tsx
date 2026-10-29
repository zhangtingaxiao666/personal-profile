import {
  Alert,
  App,
  Button,
  Card,
  Empty,
  Input,
  List,
  Result,
  Select,
  Space,
  Spin,
  Tabs,
  Typography
} from 'antd'
import {
  DeleteOutlined,
  FileDoneOutlined,
  FileOutlined,
  FilePdfOutlined,
  FileTextOutlined,
  FileImageOutlined,
  InboxOutlined,
  LoadingOutlined,
  RobotOutlined
} from '@ant-design/icons'
import { useEffect, useRef, useState } from 'react'
import type { ExtractInput, ExtractResult } from '@shared/types'
import { errMsg, useApp, useVisibleCategories } from '../store'
import { fileToExtractInput } from '../lib/pdf'
import ReviewCandidates from '../components/ReviewCandidates'

interface Props {
  navigate: (k: string) => void
  isVisible?: boolean
}

function getFileIcon(name: string) {
  const ext = name.toLowerCase().split('.').pop()
  if (ext === 'pdf') return <FilePdfOutlined style={{ color: '#ff4d4f' }} />
  if (['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif'].includes(ext ?? '')) {
    return <FileImageOutlined style={{ color: '#52c41a' }} />
  }
  if (['txt', 'md'].includes(ext ?? '')) return <FileTextOutlined style={{ color: '#faad14' }} />
  if (['docx', 'doc'].includes(ext ?? '')) return <FileDoneOutlined style={{ color: '#1677ff' }} />
  return <FileOutlined />
}

const AI_IMPORT_CACHE_KEY = 'personal_profile_ai_import_state_v1'

interface CachedAiImportState {
  activeTab?: 'file' | 'text'
  filePaths?: string[]
  oralText?: string
  result?: ExtractResult | null
}

function loadAiImportCache(): CachedAiImportState {
  try {
    const raw = localStorage.getItem(AI_IMPORT_CACHE_KEY)
    if (!raw) return {}
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

export default function AiImport({ navigate, isVisible = true }: Props) {
  const { message } = App.useApp()
  const { refresh, setAiImportStatus } = useApp()
  const cats = useVisibleCategories()
  const isVisibleRef = useRef(isVisible)
  isVisibleRef.current = isVisible

  const cached = useRef(loadAiImportCache()).current

  const [activeTab, setActiveTab] = useState<'file' | 'text'>(cached.activeTab ?? 'file')
  const [filePaths, setFilePaths] = useState<string[]>(cached.filePaths ?? [])
  const [isDragging, setIsDragging] = useState(false)

  const [oralText, setOralText] = useState(cached.oralText ?? '')
  const [categoryHint, setCategoryHint] = useState<string | undefined>()

  const [loading, setLoading] = useState(false)
  const [progressText, setProgressText] = useState('')

  const [result, setResult] = useState<ExtractResult | null>(cached.result ?? null)
  const [emptyResultWarnings, setEmptyResultWarnings] = useState<string[] | null>(null)
  const [importedCount, setImportedCount] = useState<number | null>(null)

  useEffect(() => {
    try {
      const payload: CachedAiImportState = { activeTab, filePaths, oralText, result }
      localStorage.setItem(AI_IMPORT_CACHE_KEY, JSON.stringify(payload))
    } catch {
      // ignore
    }
  }, [activeTab, filePaths, oralText, result])

  useEffect(() => {
    const pending = result
      ? (result.candidates?.length ?? 0) + (Object.keys(result.profilePatch ?? {}).length > 0 ? 1 : 0)
      : 0
    setAiImportStatus(loading, pending)
  }, [loading, result, setAiImportStatus])

  const handleError = (e: unknown) => {
    const msg = errMsg(e)
    const isKeyError =
      /api\s*key/i.test(msg) || msg.includes('密钥') || msg.includes('未配置')
    if (isKeyError) {
      message.error(
        <span>
          {msg}{' '}
          <Button
            type="link"
            size="small"
            onClick={() => navigate('settings')}
            style={{ padding: '0 4px' }}
          >
            前往设置
          </Button>
        </span>,
        6
      )
    } else {
      message.error(msg)
    }
  }

  const handlePickFiles = async () => {
    try {
      const picked = await window.api.pickFiles({ docs: true, multi: true })
      if (picked && picked.length > 0) {
        setFilePaths((prev) => Array.from(new Set([...prev, ...picked])))
      }
    } catch (e) {
      handleError(e)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const paths: string[] = []
      for (let i = 0; i < e.dataTransfer.files.length; i++) {
        const file = e.dataTransfer.files[i]
        const p = window.api.getPathForFile(file)
        if (p) paths.push(p)
      }
      if (paths.length > 0) {
        setFilePaths((prev) => Array.from(new Set([...prev, ...paths])))
      }
    }
  }

  const removeFile = (pathToRemove: string) => {
    setFilePaths((prev) => prev.filter((p) => p !== pathToRemove))
  }

  const checkAndSetResult = (res: ExtractResult) => {
    const hasCandidates = res.candidates && res.candidates.length > 0
    const hasProfilePatch = res.profilePatch && Object.keys(res.profilePatch).length > 0
    if (!hasCandidates && !hasProfilePatch) {
      setEmptyResultWarnings(res.warnings || [])
      setResult(null)
    } else {
      setEmptyResultWarnings(null)
      setResult(res)
      if (!isVisibleRef.current) {
        const count = res.candidates?.length ?? 0
        message.success(
          <span>
            后台 AI 整理已完成，识别出 {count} 条候选资料！
            <Button type="link" size="small" onClick={() => navigate('ai-import')}>
              立即前往审核
            </Button>
          </span>,
          5
        )
      }
    }
  }

  const handleExtractFiles = async () => {
    if (filePaths.length === 0) return
    setLoading(true)
    try {
      const inputs: ExtractInput[] = []
      for (let i = 0; i < filePaths.length; i++) {
        setProgressText(`读取与解析文件 (${i + 1}/${filePaths.length})…`)
        const payload = await window.api.readFileForParse(filePaths[i])
        const input = await fileToExtractInput(payload)
        inputs.push(input)
      }
      setProgressText('AI 正在识别…')
      const res = await window.api.extractFromInputs(inputs)
      checkAndSetResult(res)
    } catch (e) {
      handleError(e)
    } finally {
      setLoading(false)
      setProgressText('')
    }
  }

  const handleOrganizeText = async () => {
    const t = oralText.trim()
    if (!t) {
      message.warning('请输入需要整理的文字内容')
      return
    }
    setLoading(true)
    setProgressText('AI 正在整理…')
    try {
      const res = await window.api.organizeText(t, categoryHint || undefined)
      checkAndSetResult(res)
    } catch (e) {
      handleError(e)
    } finally {
      setLoading(false)
      setProgressText('')
    }
  }

  const handleDone = async (committedCount: number) => {
    await refresh()
    setImportedCount(committedCount)
    setResult(null)
  }

  if (importedCount !== null) {
    return (
      <div className="page">
        <Card>
          <Result
            status="success"
            title="资料入库完成"
            subTitle={`已成功入库 ${importedCount} 条资料`}
            extra={[
              <Button type="primary" key="dashboard" onClick={() => navigate('dashboard')}>
                前往总览
              </Button>,
              <Button
                key="continue"
                onClick={() => {
                  setImportedCount(null)
                  setFilePaths([])
                  setOralText('')
                }}
              >
                继续导入
              </Button>
            ]}
          />
        </Card>
      </div>
    )
  }

  if (emptyResultWarnings !== null) {
    return (
      <div className="page">
        <Card>
          <Empty
            description={
              <Space direction="vertical" align="center">
                <Typography.Title level={4} style={{ margin: '8px 0 0' }}>
                  未识别到可入库的信息
                </Typography.Title>
                <span className="muted">请检查上传的文件或补充口述内容后重试</span>
              </Space>
            }
          >
            {emptyResultWarnings.length > 0 && (
              <Alert
                type="warning"
                showIcon
                message="识别提示"
                description={
                  <ul style={{ margin: 0, paddingLeft: 18, textAlign: 'left' }}>
                    {emptyResultWarnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                }
                style={{ maxWidth: 640, margin: '16px auto', textAlign: 'left' }}
              />
            )}
            <Button
              type="primary"
              onClick={() => {
                setEmptyResultWarnings(null)
              }}
            >
              返回重试
            </Button>
          </Empty>
        </Card>
      </div>
    )
  }

  if (result) {
    return (
      <div className="page">
        <div className="page-header">
          <h2>
            <RobotOutlined /> 审核 AI 识别结果
          </h2>
        </div>
        <ReviewCandidates
          result={result}
          onDone={handleDone}
          onCancel={() => setResult(null)}
        />
      </div>
    )
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2>
          <RobotOutlined /> AI 整理导入
        </h2>
      </div>

      <Card>
        <Tabs
          activeKey={activeTab}
          onChange={(k) => setActiveTab(k as 'file' | 'text')}
          items={[
            {
              key: 'file',
              label: '从文件提取',
              children: (
                <Space direction="vertical" style={{ width: '100%' }} size={16}>
                  <Alert
                    type="info"
                    showIcon
                    title="支持上传简历、证书图片、成绩单、荣誉证书等文档，AI 会自动归类提取经历与字段並自动检测重复/冲突。开始提取后可随时切换到其他页面浏览资料，任务会在后台继续运行。"
                  />

                  <div
                    className={`drop-zone ${isDragging ? 'active' : ''}`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={handlePickFiles}
                  >
                    <InboxOutlined style={{ fontSize: 44, color: '#1f4e79', marginBottom: 8 }} />
                    <div style={{ fontSize: 16, fontWeight: 500, color: '#262626' }}>
                      点击选择或拖拽文件到此处
                    </div>
                    <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                      支持 PDF、Word (.docx)、图片（PNG/JPG/WEBP）、TXT
                    </div>
                  </div>

                  {filePaths.length > 0 && (
                    <Card
                      size="small"
                      title={
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span>已选择 {filePaths.length} 个文件</span>
                          <Button size="small" type="link" onClick={() => setFilePaths([])}>
                            清空列表
                          </Button>
                        </div>
                      }
                    >
                      <List
                        size="small"
                        dataSource={filePaths}
                        renderItem={(p) => {
                          const fn = p.replace(/\\/g, '/').split('/').pop() || p
                          return (
                            <List.Item
                              actions={[
                                <Button
                                  key="del"
                                  type="text"
                                  size="small"
                                  danger
                                  icon={<DeleteOutlined />}
                                  onClick={(e) => {
                                    e.stopPropagation()
                                    removeFile(p)
                                  }}
                                />
                              ]}
                            >
                              <Space>
                                {getFileIcon(fn)}
                                <span>{fn}</span>
                              </Space>
                            </List.Item>
                          )
                        }}
                      />
                    </Card>
                  )}

                  {loading && (
                    <div style={{ textAlign: 'center', padding: '12px 0' }}>
                      <Spin indicator={<LoadingOutlined style={{ fontSize: 24 }} spin />} />
                      <div className="muted" style={{ marginTop: 8 }}>
                        {progressText}
                      </div>
                    </div>
                  )}

                  <Button
                    type="primary"
                    size="large"
                    block
                    loading={loading}
                    disabled={filePaths.length === 0}
                    onClick={handleExtractFiles}
                  >
                    开始 AI 提取
                  </Button>
                </Space>
              )
            },
            {
              key: 'text',
              label: '口述整理',
              children: (
                <Space direction="vertical" style={{ width: '100%' }} size={16}>
                  <Alert
                    type="info"
                    showIcon
                    message="随意粘贴或口述你的经历片段，AI 将提取为结构化字段并补充到对应分类中。"
                  />

                  <div>
                    <div style={{ marginBottom: 6, fontWeight: 500 }}>经历描述：</div>
                    <Input.TextArea
                      rows={8}
                      value={oralText}
                      onChange={(e) => setOralText(e.target.value)}
                      placeholder="例如：大三时和两个同学做了一个校园二手交易小程序，我负责后端架构设计与 API 开发，使用 NestJS + PostgreSQL，上线后覆盖了校内 3000 多名用户，日均 PV 超过 1 万……"
                      autoSize={{ minRows: 6, maxRows: 16 }}
                    />
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span style={{ fontWeight: 500 }}>归入分类：</span>
                    <Select
                      allowClear
                      style={{ width: 220 }}
                      placeholder="让 AI 自动判断分类（可留空）"
                      value={categoryHint}
                      onChange={setCategoryHint}
                      options={cats.map((c) => ({ label: c.label, value: c.id }))}
                    />
                    <span className="muted" style={{ fontSize: 13 }}>
                      若不确定可留空，AI 会自动分流到最合适分类
                    </span>
                  </div>

                  {loading && (
                    <div style={{ textAlign: 'center', padding: '12px 0' }}>
                      <Spin indicator={<LoadingOutlined style={{ fontSize: 24 }} spin />} />
                      <div className="muted" style={{ marginTop: 8 }}>
                        {progressText}
                      </div>
                    </div>
                  )}

                  <Button
                    type="primary"
                    size="large"
                    block
                    loading={loading}
                    disabled={!oralText.trim()}
                    onClick={handleOrganizeText}
                  >
                    AI 整理
                  </Button>
                </Space>
              )
            }
          ]}
        />
      </Card>
    </div>
  )
}
