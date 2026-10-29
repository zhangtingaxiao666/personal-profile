import {
  Alert,
  App,
  Button,
  Card,
  Empty,
  Input,
  List,
  Radio,
  Select,
  Space,
  Spin,
  Tag,
  Typography
} from 'antd'
import {
  CameraOutlined,
  CheckCircleOutlined,
  FileDoneOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  QuestionCircleOutlined,
  SaveOutlined,
  UploadOutlined
} from '@ant-design/icons'
import { useEffect, useRef, useState } from 'react'
import type { DocFillAnalysis, DocFillAnswerInput, DocFillSlot } from '@shared/types'
import { errMsg, useApp } from '../store'

const DOC_FILL_CACHE_KEY = 'personal_profile_docfill_state_v1'
const PHOTO_SLOT_MARKER = '[已关联个人证件照，写入时将自动嵌入一寸照片]'

interface CachedDocFillState {
  analysis: DocFillAnalysis | null
  slots: DocFillSlot[]
  answers: Record<string, string>
  saveKinds: Record<string, 'profile' | 'snippet'>
  writeMode: 'newFile' | 'overwrite'
  customNewPath: string
  lastSavedPath: string | null
}

function loadCachedDocFillState(): Partial<CachedDocFillState> {
  try {
    const raw = localStorage.getItem(DOC_FILL_CACHE_KEY)
    if (!raw) return {}
    return JSON.parse(raw) as Partial<CachedDocFillState>
  } catch {
    return {}
  }
}

interface Props {
  isVisible?: boolean
  onStatusChange?: (busy: boolean, pendingCount: number) => void
}

export default function DocAutoFillCard({ isVisible = true, onStatusChange }: Props) {
  const { message } = App.useApp()
  const refresh = useApp((s) => s.refresh)

  const cached = useRef(loadCachedDocFillState()).current

  const [analyzing, setAnalyzing] = useState(false)
  const [analysis, setAnalysis] = useState<DocFillAnalysis | null>(cached.analysis ?? null)
  const [slots, setSlots] = useState<DocFillSlot[]>(cached.slots ?? [])
  /** 缺失项的用户回答草稿：slotId -> answer */
  const [answers, setAnswers] = useState<Record<string, string>>(cached.answers ?? {})
  /** 缺失项保存类型覆盖：slotId -> 'profile' | 'snippet' */
  const [saveKinds, setSaveKinds] = useState<Record<string, 'profile' | 'snippet'>>(cached.saveKinds ?? {})
  const [savingAnswers, setSavingAnswers] = useState(false)

  /** 写入模式：newFile（默认同文件夹新文件） | overwrite（直接覆盖原文件） */
  const [writeMode, setWriteMode] = useState<'newFile' | 'overwrite'>(cached.writeMode ?? 'newFile')
  const [customNewPath, setCustomNewPath] = useState(cached.customNewPath ?? '')
  const [writing, setWriting] = useState(false)
  const [lastSavedPath, setLastSavedPath] = useState<string | null>(cached.lastSavedPath ?? null)
  const [dragOver, setDragOver] = useState(false)

  const isVisibleRef = useRef(isVisible)
  useEffect(() => {
    isVisibleRef.current = isVisible
  }, [isVisible])

  // 实时持久化填表草稿到 localStorage，防止切换页面、刷新或重启丢失已填内容
  useEffect(() => {
    try {
      const payload: CachedDocFillState = {
        analysis,
        slots,
        answers,
        saveKinds,
        writeMode,
        customNewPath,
        lastSavedPath
      }
      localStorage.setItem(DOC_FILL_CACHE_KEY, JSON.stringify(payload))
    } catch {
      // ignore storage quota errors
    }
  }, [analysis, slots, answers, saveKinds, writeMode, customNewPath, lastSavedPath])

  // 同步后台运行状态与待填槽位数给父组件/侧边栏
  useEffect(() => {
    onStatusChange?.(analyzing || writing, slots.length)
  }, [analyzing, writing, slots.length, onStatusChange])

  const startAnalyzeFile = async (filePath: string) => {
    const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
    if (!['docx', 'txt', 'md', 'csv', 'tsv', 'html'].includes(ext)) {
      message.warning('请选择 .docx（Word 表格文档）或 .txt / .md / .csv 格式的待填文件（若为旧版 .doc 请先另存为 .docx）')
      return
    }
    setAnalyzing(true)
    setLastSavedPath(null)
    try {
      const res = await window.api.analyzeDocForFill(filePath)
      setAnalysis(res)
      setSlots(res.slots)
      setCustomNewPath(res.defaultNewPath)
      setAnswers({})
      const initKinds: Record<string, 'profile' | 'snippet'> = {}
      res.slots.forEach((s) => {
        if (s.saveKind) initKinds[s.slotId] = s.saveKind
      })
      setSaveKinds(initKinds)

      const filledCount = res.slots.filter((s) => s.status === 'filled').length
      const missingCount = res.slots.filter((s) => s.status === 'missing').length
      const prefix = !isVisibleRef.current ? '【后台文件填表完成】' : ''
      if (res.slots.length === 0) {
        message.info(`${prefix}未在该文件中识别出空白待填项`)
      } else if (missingCount > 0) {
        message.warning(
          `${prefix}已从资料库自动检索填写 ${filledCount} 项；有 ${missingCount} 项资料库中暂无记录，请前往「快速填表」回答补充（绝不胡编乱造）`
        )
      } else {
        message.success(`${prefix}已从资料库与文献库完整匹配全部 ${filledCount} 个待填项！`)
      }
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setAnalyzing(false)
    }
  }

  const handlePickFile = async () => {
    try {
      const paths = await window.api.pickFiles({ multi: false, docs: true })
      if (!paths.length) return
      await startAnalyzeFile(paths[0])
    } catch (e) {
      message.error(errMsg(e))
    }
  }

  /** 为表格中的「照片/证件照」栏选择或更换证件照，自动保存至基本信息并标记为嵌入照片 */
  const handlePickPhotoForSlot = async (slotId: string) => {
    try {
      const paths = await window.api.pickFiles({ images: true, multi: false })
      if (!paths.length) return
      await window.api.setAvatar(paths[0])
      await refresh()
      setSlots((prev) =>
        prev.map((s) =>
          s.slotId === slotId || s.isPhoto
            ? {
                ...s,
                status: 'filled',
                value: PHOTO_SLOT_MARKER,
                source: '基本信息-个人证件照（自动嵌入图片）',
                isPhoto: true
              }
            : s
        )
      )
      message.success('已上传个人证件照，写入 Word 文件时将自动把照片嵌入对应单元格！')
    } catch (e) {
      message.error(errMsg(e))
    }
  }

  // 将用户填写的缺失项回答同步到 slots 并持久化到数据库
  const persistPendingAnswers = async (showToast = true): Promise<DocFillSlot[]> => {
    const toSave: DocFillAnswerInput[] = []
    const nextSlots = slots.map((s) => {
      if (s.isPhoto) return s
      const ans = (answers[s.slotId] ?? s.value ?? '').trim()
      if (s.status === 'missing' && ans) {
        toSave.push({
          slotId: s.slotId,
          label: s.label,
          answer: ans,
          saveKey: s.saveKey || s.label,
          saveKind: saveKinds[s.slotId] ?? s.saveKind ?? 'profile'
        })
        return {
          ...s,
          status: 'filled' as const,
          value: ans,
          source: '用户补充回答（已记入资料库）'
        }
      }
      return s
    })

    if (toSave.length > 0) {
      setSavingAnswers(true)
      try {
        await window.api.saveDocFillAnswers(toSave)
        setSlots(nextSlots)
        setAnswers({})
        await refresh()
        if (showToast) {
          message.success(`已将 ${toSave.length} 项补充回答填入表格，并永久记入资料库供后续使用`)
        }
      } finally {
        setSavingAnswers(false)
      }
    } else if (showToast) {
      message.info('请先在输入框中填写至少一项补充回答')
    }
    return nextSlots
  }

  const handleWriteFile = async () => {
    if (!analysis) return
    setWriting(true)
    try {
      // 若用户已经在追问框里输入了回答但还没点“保存回答”，自动帮用户先记入资料库并更新槽位
      const latestSlots = await persistPendingAnswers(false)
      const nonEmptySlots = latestSlots
        .filter((s) => s.value && s.value.trim())
        .map((s) => ({ slotId: s.slotId, value: s.value.trim() }))

      if (nonEmptySlots.length === 0) {
        message.warning('当前没有可写入的非空字段内容')
        return
      }

      const res = await window.api.writeFilledDoc({
        sourcePath: analysis.filePath,
        mode: writeMode,
        targetPath: writeMode === 'newFile' ? customNewPath.trim() || analysis.defaultNewPath : undefined,
        slots: nonEmptySlots
      })
      setLastSavedPath(res.outPath)
      message.success(
        writeMode === 'overwrite'
          ? `已直接在原文件上完成填写（共写入 ${res.filledCount} 处）：${res.outPath}`
          : `已生成填写后的新文件（共写入 ${res.filledCount} 处）：${res.outPath}`
      )
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setWriting(false)
    }
  }

  const handleBrowseSavePath = async () => {
    if (!analysis) return
    const chosen = await window.api.chooseSavePath(customNewPath || analysis.defaultNewPath)
    if (chosen) {
      setCustomNewPath(chosen)
    }
  }

  const missingSlots = slots.filter((s) => s.status === 'missing')
  const filledSlots = slots.filter((s) => s.status === 'filled')

  return (
    <Card
      size="small"
      style={{
        marginBottom: 20,
        borderColor: '#b7eb8f',
        background: '#fcffe6'
      }}
      title={
        <Space wrap>
          <FileDoneOutlined style={{ color: '#389e0d', fontSize: 16 }} />
          <span>📄 智能文件填表（上传需填写的 Word/文本表格 → AI 检索文献与资料库自动填写）</span>
          <Tag color="green">严禁胡编乱造 · 未知项追问并自动记忆</Tag>
        </Space>
      }
      extra={
        analysis && (
          <Button
            size="small"
            onClick={() => {
              setAnalysis(null)
              setSlots([])
              setAnswers({})
              setLastSavedPath(null)
            }}
          >
            重新选择文件
          </Button>
        )
      }
    >
      {/* 文件拖拽/选择区 */}
      <div
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={async (e) => {
          e.preventDefault()
          setDragOver(false)
          const files = Array.from(e.dataTransfer.files)
          if (files.length > 0) {
            const p = window.api.getPathForFile(files[0])
            if (p) await startAnalyzeFile(p)
          }
        }}
        style={{
          padding: analysis ? '10px 14px' : '18px 16px',
          border: `1px dashed ${dragOver ? '#389e0d' : '#b7eb8f'}`,
          borderRadius: 8,
          background: dragOver ? '#f6ffed' : '#ffffff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12
        }}
      >
        <Space wrap>
          <FileTextOutlined style={{ fontSize: 20, color: '#389e0d' }} />
          {analysis ? (
            <div>
              <Typography.Text strong>{analysis.fileName}</Typography.Text>
              <div className="muted" style={{ fontSize: 12 }}>
                源路径：{analysis.filePath}
              </div>
            </div>
          ) : (
            <div>
              <Typography.Text strong>
                拖拽需要填写的报名表 / 申请表 / 登记表（.docx / .txt / .md / .csv）到此处，或点击右侧按钮选择
              </Typography.Text>
              <div className="muted" style={{ fontSize: 12 }}>
                AI 会自动检索您的基本信息、科研论文文献库、获奖经历与已存问答库；查不到的信息会向您询问并记录，绝不瞎编。
              </div>
            </div>
          )}
        </Space>
        <Button
          type="primary"
          icon={<UploadOutlined />}
          loading={analyzing}
          onClick={handlePickFile}
          style={{ background: '#389e0d', borderColor: '#389e0d' }}
        >
          {analysis ? '更换待填文件' : '选择需要填写的文件'}
        </Button>
      </div>

      {analyzing && (
        <div style={{ padding: 32, textAlign: 'center' }}>
          <Spin tip="AI 正在解析文档表格结构并检索个人资料库与文献库…" />
        </div>
      )}

      {!analyzing && analysis && (
        <Space direction="vertical" style={{ width: '100%', marginTop: 14 }} size={14}>
          {/* 检索统计概览 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <Space wrap>
              <Tag color="success" icon={<CheckCircleOutlined />}>
                已从资料库检索匹配：{filledSlots.length} 项
              </Tag>
              {missingSlots.length > 0 && (
                <Tag color="warning" icon={<QuestionCircleOutlined />}>
                  资料库未找到（待您回答补充）：{missingSlots.length} 项
                </Tag>
              )}
            </Space>
          </div>

          {/* 1. 缺失资料追问面板（严禁胡编乱造，询问用户并记录） */}
          {missingSlots.length > 0 && (
            <Alert
              type="warning"
              showIcon
              icon={<QuestionCircleOutlined />}
              message={
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
                  <Typography.Text strong>
                    以下 {missingSlots.length} 项在资料库/文献库中未找到对应信息（AI 绝不胡编乱造，请您回答后将自动记录供后续复用）
                  </Typography.Text>
                  <Button
                    size="small"
                    type="primary"
                    icon={<SaveOutlined />}
                    loading={savingAnswers}
                    onClick={() => persistPendingAnswers(true)}
                  >
                    确认回答并记入资料库
                  </Button>
                </div>
              }
              description={
                <List
                  size="small"
                  style={{ marginTop: 8 }}
                  dataSource={missingSlots}
                  renderItem={(slot) => {
                    const curKind = saveKinds[slot.slotId] ?? slot.saveKind ?? 'profile'
                    return (
                      <List.Item style={{ padding: '8px 0', borderBottom: '1px dashed #ffe58f' }}>
                        <div style={{ width: '100%' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, flexWrap: 'wrap', gap: 6 }}>
                            <Space size={6} wrap>
                              <Tag color={slot.isPhoto ? 'purple' : 'orange'}>
                                {slot.isPhoto ? '📷 证件照栏' : slot.label}
                              </Tag>
                              <Typography.Text strong style={{ fontSize: 13 }}>
                                {slot.question || `请补充「${slot.label}」：`}
                              </Typography.Text>
                            </Space>
                            {slot.isPhoto ? (
                              <Button
                                size="small"
                                type="primary"
                                icon={<CameraOutlined />}
                                onClick={() => handlePickPhotoForSlot(slot.slotId)}
                              >
                                选择证件照并自动填入
                              </Button>
                            ) : (
                              <Space size={4}>
                                <span className="muted" style={{ fontSize: 12 }}>回答后记入：</span>
                                <Select
                                  size="small"
                                  value={curKind}
                                  onChange={(v) => setSaveKinds((prev) => ({ ...prev, [slot.slotId]: v }))}
                                  options={[
                                    { label: `基本信息字段（${slot.saveKey || slot.label}）`, value: 'profile' },
                                    { label: `问答记忆库（${slot.saveKey || slot.label}）`, value: 'snippet' }
                                  ]}
                                  style={{ width: 220 }}
                                />
                              </Space>
                            )}
                          </div>
                          {!slot.isPhoto && (
                            <Input.TextArea
                              autoSize={{ minRows: 1, maxRows: 4 }}
                              placeholder={`请输入「${slot.label}」的真实内容，填写后将自动填入文档并永久保存至资料库…`}
                              value={answers[slot.slotId] ?? ''}
                              onChange={(e) => {
                                const v = e.target.value
                                setAnswers((prev) => ({ ...prev, [slot.slotId]: v }))
                              }}
                            />
                          )}
                        </div>
                      </List.Item>
                    )
                  }}
                />
              }
            />
          )}

          {/* 2. 已匹配及全部待填项预览与微调 */}
          {slots.length === 0 ? (
            <Empty description="未在该文档中识别出空白待填单元格或填空项" />
          ) : (
            <Card
              size="small"
              title={`待写入文档的栏目明细（共 ${slots.length} 项，可在写入前任意微调）`}
              style={{ background: '#ffffff' }}
            >
              <List
                size="small"
                dataSource={slots}
                renderItem={(slot) => {
                  const displayVal =
                    slot.status === 'missing' && answers[slot.slotId] !== undefined
                      ? answers[slot.slotId]
                      : slot.value
                  return (
                    <List.Item style={{ padding: '6px 4px' }}>
                      <div style={{ width: '100%' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4, flexWrap: 'wrap', gap: 6 }}>
                          <Space size={6} wrap>
                            <Typography.Text strong style={{ fontSize: 13 }}>
                              {slot.label}
                            </Typography.Text>
                            <Tag style={{ fontSize: 11 }}>{slot.slotId}</Tag>
                            {slot.isPhoto && (
                              <Tag color="purple" style={{ fontSize: 11 }}>
                                📷 自动嵌入一寸证件照
                              </Tag>
                            )}
                            {slot.status === 'filled' ? (
                              <Tag color="green" style={{ fontSize: 11 }}>
                                {slot.source || '资料库已匹配'}
                              </Tag>
                            ) : displayVal?.trim() ? (
                              <Tag color="blue" style={{ fontSize: 11 }}>
                                已由您补充（写入时自动记入资料库）
                              </Tag>
                            ) : (
                              <Tag color="warning" style={{ fontSize: 11 }}>
                                待补充
                              </Tag>
                            )}
                          </Space>
                          {slot.isPhoto && (
                            <Button
                              size="small"
                              icon={<CameraOutlined />}
                              onClick={() => handlePickPhotoForSlot(slot.slotId)}
                            >
                              {slot.status === 'filled' ? '更换证件照' : '上传证件照'}
                            </Button>
                          )}
                        </div>
                        <Input.TextArea
                          autoSize={{ minRows: 1, maxRows: 5 }}
                          value={displayVal}
                          disabled={slot.isPhoto && displayVal === PHOTO_SLOT_MARKER}
                          placeholder="待填写内容…"
                          onChange={(e) => {
                            const val = e.target.value
                            if (slot.status === 'missing') {
                              setAnswers((prev) => ({ ...prev, [slot.slotId]: val }))
                            } else {
                              setSlots((prev) =>
                                prev.map((s) => (s.slotId === slot.slotId ? { ...s, value: val } : s))
                              )
                            }
                          }}
                          style={{ fontSize: 13 }}
                        />
                      </div>
                    </List.Item>
                  )
                }}
              />
            </Card>
          )}

          {/* 3. 选择写入原文件 vs 另存为新文件（默认同一文件夹） */}
          {slots.length > 0 && (
            <Card size="small" title="选择保存方式并写入文件" style={{ background: '#ffffff' }}>
              <Space direction="vertical" style={{ width: '100%' }} size={12}>
                <Radio.Group
                  value={writeMode}
                  onChange={(e) => setWriteMode(e.target.value)}
                  style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
                >
                  <Radio value="newFile">
                    <Typography.Text strong>
                      生成填写后的新文件（推荐，默认保存在原文件同一文件夹）
                    </Typography.Text>
                  </Radio>
                  <Radio value="overwrite">
                    <Typography.Text strong>
                      直接在原文件上填写并覆盖保存（{analysis.filePath}）
                    </Typography.Text>
                  </Radio>
                </Radio.Group>

                {writeMode === 'newFile' && (
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', paddingLeft: 24 }}>
                    <Input
                      value={customNewPath}
                      onChange={(e) => setCustomNewPath(e.target.value)}
                      addonBefore="新文件保存路径"
                      placeholder={analysis.defaultNewPath}
                    />
                    <Button icon={<FolderOpenOutlined />} onClick={handleBrowseSavePath}>
                      浏览位置…
                    </Button>
                  </div>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                  <Button
                    type="primary"
                    size="large"
                    icon={<FileDoneOutlined />}
                    loading={writing}
                    onClick={handleWriteFile}
                    style={{ background: '#389e0d', borderColor: '#389e0d' }}
                  >
                    {writeMode === 'overwrite'
                      ? '✍️ 直接在原文件上填写并保存'
                      : '✍️ 生成填写后的新文件（并保存补充回答）'}
                  </Button>

                  {lastSavedPath && (
                    <Space wrap>
                      <Tag color="success">已保存：{lastSavedPath}</Tag>
                      <Button
                        size="small"
                        type="primary"
                        ghost
                        icon={<FileTextOutlined />}
                        onClick={() =>
                          window.api.openExternalPath(lastSavedPath, false).catch((e) => message.error(errMsg(e)))
                        }
                      >
                        打开填写后的文件
                      </Button>
                      <Button
                        size="small"
                        icon={<FolderOpenOutlined />}
                        onClick={() =>
                          window.api.openExternalPath(lastSavedPath, true).catch((e) => message.error(errMsg(e)))
                        }
                      >
                        在文件夹中显示
                      </Button>
                    </Space>
                  )}
                </div>
              </Space>
            </Card>
          )}
        </Space>
      )}
    </Card>
  )
}
