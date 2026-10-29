import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Empty,
  Input,
  InputNumber,
  List,
  Modal,
  Popconfirm,
  Radio,
  Row,
  Segmented,
  Space,
  Switch,
  Tag,
  TreeSelect,
  Typography
} from 'antd'
import {
  CommentOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  ImportOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  RollbackOutlined,
  SaveOutlined,
  StopOutlined,
  ThunderboltOutlined
} from '@ant-design/icons'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AiStreamEvent } from '@shared/ipc'
import type { GenerateRequest, Snippet } from '@shared/types'
import { entryTitle } from '@shared/categories'
import { errMsg, useApp, useVisibleCategories } from '../store'
import CopyButton from '../components/CopyButton'

const GENERATOR_CACHE_KEY = 'personal_profile_generator_state_v1'

interface CachedGeneratorState {
  requirement?: string
  wordLimit?: number
  tone?: 'formal' | 'concise' | 'warm'
  output?: string
  history?: string[]
}

function loadGeneratorCache(): CachedGeneratorState {
  try {
    const raw = localStorage.getItem(GENERATOR_CACHE_KEY)
    if (!raw) return {}
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

const TEMPLATES = [
  { label: '自我介绍（200 字）', text: '请用 200 字左右做一段自然真诚的自我介绍，融合专业背景与核心经历，不要用“在XX方面”分段。', limit: 200 },
  { label: '个人简介（100 字）', text: '请写一段 100 字左右的平实个人简介，适用于简历或主页，直奔主题不写套话。', limit: 100 },
  { label: '项目与科研经历概述', text: '请连贯梳理我的核心项目与科研经验，讲清楚具体做了什么、用了什么方法以及实际结果。' },
  { label: '获奖与专长说明', text: '请客观平实地总结我的获奖情况与专业特长，用事实说话。' },
  { label: '求职信 / 自荐信', text: '请根据我的经历与背景撰写一份真诚不浮夸的自荐信，结合具体经历说明匹配度。' },
  { label: '保研/复试口述自我介绍', text: '请写一段适合保研或研究生复试现场直接脱稿口述的自我介绍，口语自然、谦逊踏实。', limit: 350 }
]

const QUICK_FEEDBACKS = [
  {
    label: '🗣️ 去 AI 味 / 更像真人说话',
    prompt: '去掉生硬的 AI 腔和公文套话，改用自然、朴实、像真人面对面交谈或自己手写的语气'
  },
  {
    label: '🚫 打破“在XX方面”死板套路',
    prompt: '彻底删掉“在学习方面…在科研方面…在实践方面…综上所述”这种死板的八股分段公式，把经历自然连贯地融合成整体叙述'
  },
  {
    label: '🎤 改为自然面试口语',
    prompt: '改写为适合面试现场直接脱稿口述的自然口语版本，句子简短顺口、去掉书面连接词'
  },
  {
    label: '🔬 突出具体经历与数据细节',
    prompt: '减少泛泛而谈的总结，重点展开我具体做过的科研/项目方法和真实成绩细节'
  },
  {
    label: '✂️ 删减客套话与空洞形容词',
    prompt: '删掉所有自我吹捧、情绪化形容词和空洞套话，只保留最实在的事实干货'
  },
  {
    label: '📉 精简压缩篇幅',
    prompt: '在保留核心亮点事实的前提下，大幅精简字数，让表达更紧凑干练'
  }
]

export default function Generator() {
  const { message } = App.useApp()
  const { db, refresh } = useApp()
  const cats = useVisibleCategories()

  const cached = useRef(loadGeneratorCache()).current

  // ---- 参数 ----
  const [requirement, setRequirement] = useState(cached.requirement ?? '')
  const [wordLimit, setWordLimit] = useState<number | undefined>(cached.wordLimit)
  const [tone, setTone] = useState<'formal' | 'concise' | 'warm'>(cached.tone ?? 'formal')
  const [dataMode, setDataMode] = useState<'all' | 'custom'>('all')
  const [selectedEntryIds, setSelectedEntryIds] = useState<string[]>([])
  const [includeProfile, setIncludeProfile] = useState(true)

  // ---- 输出、版本历史与针对性修改意见 ----
  const [output, setOutput] = useState(cached.output ?? '')
  const [history, setHistory] = useState<string[]>(cached.history ?? [])
  const [refineFeedback, setRefineFeedback] = useState('')
  const [generating, setGenerating] = useState(false)
  const activeRequestIdRef = useRef<string | null>(null)

  // 实时缓存生成草稿与历史版本到 localStorage
  useEffect(() => {
    try {
      const payload: CachedGeneratorState = {
        requirement,
        wordLimit,
        tone,
        output,
        history: history.slice(-10)
      }
      localStorage.setItem(GENERATOR_CACHE_KEY, JSON.stringify(payload))
    } catch {
      // ignore
    }
  }, [requirement, wordLimit, tone, output, history])

  // ---- 文案库保存弹窗 ----
  const [saveModalOpen, setSaveModalOpen] = useState(false)
  const [saveTitle, setSaveTitle] = useState('')
  const [currentSnippetId, setCurrentSnippetId] = useState<string | null>(null)
  const [saveMode, setSaveMode] = useState<'overwrite' | 'new'>('new')

  // 监听流式事件
  useEffect(() => {
    const unsub = window.api.onAiStream((evt: AiStreamEvent) => {
      if (evt.requestId !== activeRequestIdRef.current) return
      if (evt.type === 'delta') {
        setOutput((prev) => prev + evt.text)
      } else if (evt.type === 'done') {
        setGenerating(false)
        activeRequestIdRef.current = null
      } else if (evt.type === 'error') {
        setGenerating(false)
        activeRequestIdRef.current = null
        message.error(errMsg(evt.message))
      }
    })

    return () => {
      unsub()
      if (activeRequestIdRef.current) {
        window.api.cancelGenerate(activeRequestIdRef.current).catch(() => {})
        activeRequestIdRef.current = null
      }
    }
  }, [message])

  // 构造资料选择树
  const treeData = useMemo(() => {
    return cats.map((cat) => {
      const catEntries = (db?.entries ?? []).filter((e) => e.category === cat.id)
      return {
        title: `${cat.label} (${catEntries.length})`,
        value: `cat:${cat.id}`,
        key: `cat:${cat.id}`,
        disabled: catEntries.length === 0,
        children: catEntries.map((e) => ({
          title: entryTitle(cat, e.data),
          value: e.id,
          key: e.id
        }))
      }
    })
  }, [cats, db])

  const handleGenerate = async () => {
    const req = requirement.trim()
    if (!req) {
      message.warning('请先填写生成要求或岗位要求')
      return
    }
    if (dataMode === 'custom' && selectedEntryIds.length === 0 && !includeProfile) {
      message.warning('请至少选择一项资料或勾选包含基本信息')
      return
    }

    if (activeRequestIdRef.current) {
      await window.api.cancelGenerate(activeRequestIdRef.current).catch(() => {})
    }

    if (output.trim()) {
      setHistory((prev) => [...prev.slice(-9), output])
    }

    const id = crypto.randomUUID()
    activeRequestIdRef.current = id
    setOutput('')
    setGenerating(true)

    try {
      const generateReq: GenerateRequest = {
        requirement: req,
        wordLimit: wordLimit || undefined,
        tone,
        entryIds: dataMode === 'custom' ? selectedEntryIds : undefined,
        includeProfile
      }
      await window.api.generateText(id, generateReq)
    } catch (e) {
      setGenerating(false)
      activeRequestIdRef.current = null
      message.error(errMsg(e))
    }
  }

  /** 对已生成文本提出修改意见进行针对性重写 */
  const handleRefine = async (customFeedback?: string) => {
    const curText = output.trim()
    if (!curText) {
      message.warning('请先生成或输入一段文本，再提出修改意见')
      return
    }
    const fb = (customFeedback ?? refineFeedback).trim()
    if (!fb) {
      message.warning('请输入您的修改意见，或点击上方的快捷修改标签')
      return
    }

    if (activeRequestIdRef.current) {
      await window.api.cancelGenerate(activeRequestIdRef.current).catch(() => {})
    }

    // 保存当前版本以便随时退回
    setHistory((prev) => [...prev.slice(-9), output])

    const id = crypto.randomUUID()
    activeRequestIdRef.current = id
    setOutput('')
    setGenerating(true)

    try {
      const generateReq: GenerateRequest = {
        requirement: requirement.trim() || '个人自述/文案打磨',
        wordLimit: wordLimit || undefined,
        tone,
        entryIds: dataMode === 'custom' ? selectedEntryIds : undefined,
        includeProfile,
        currentText: curText,
        refineFeedback: fb
      }
      await window.api.generateText(id, generateReq)
    } catch (e) {
      setGenerating(false)
      activeRequestIdRef.current = null
      message.error(errMsg(e))
    }
  }

  const handleUndoVersion = () => {
    if (history.length === 0) return
    const prevVersion = history[history.length - 1]
    setHistory((prev) => prev.slice(0, -1))
    setOutput(prevVersion)
    message.info('已退回上一版文本')
  }

  const handleStop = async () => {
    if (activeRequestIdRef.current) {
      await window.api.cancelGenerate(activeRequestIdRef.current).catch(() => {})
      activeRequestIdRef.current = null
      setGenerating(false)
      message.info('已停止生成')
    }
  }

  // 字数统计：去除所有空白字符
  const charCount = output.replace(/\s+/g, '').length
  const isOverLimit = !!(wordLimit && charCount > wordLimit)

  const openSaveModal = () => {
    if (!output.trim()) return
    const defaultTitle = requirement.trim().slice(0, 20) || '未命名文案'
    setSaveTitle(defaultTitle)
    setSaveMode(currentSnippetId ? 'overwrite' : 'new')
    setSaveModalOpen(true)
  }

  const handleSaveSnippet = async () => {
    const title = saveTitle.trim() || '未命名文案'
    try {
      const toSave = {
        id: saveMode === 'overwrite' && currentSnippetId ? currentSnippetId : undefined,
        title,
        requirement: requirement.trim(),
        content: output,
        wordLimit: wordLimit || undefined
      }
      const saved = await window.api.saveSnippet(toSave)
      setCurrentSnippetId(saved.id)
      await refresh()
      message.success(saveMode === 'overwrite' ? '已更新文案' : '已保存到文案库')
      setSaveModalOpen(false)
    } catch (e) {
      message.error(errMsg(e))
    }
  }

  const loadSnippet = (s: Snippet) => {
    setRequirement(s.requirement || '')
    setOutput(s.content)
    setWordLimit(s.wordLimit)
    setCurrentSnippetId(s.id)
    message.success(`已载入文案《${s.title}》`)
  }

  const snippets = db?.snippets ?? []

  return (
    <div className="page">
      <div className="page-header">
        <h2>
          <EditOutlined /> 文案生成
        </h2>
      </div>

      <Row gutter={[16, 16]}>
        {/* 左侧参数区（约 40%） */}
        <Col xs={24} md={10}>
          <Card title="生成参数" size="small">
            <Space direction="vertical" style={{ width: '100%' }} size={14}>
              <div>
                <div style={{ marginBottom: 6, fontWeight: 500 }}>
                  <span style={{ color: '#ff4d4f', marginRight: 4 }}>*</span>
                  填写要求 / 岗位要求：
                </div>
                <Input.TextArea
                  rows={4}
                  value={requirement}
                  onChange={(e) => setRequirement(e.target.value)}
                  placeholder="例如：请用 300 字以内介绍你的科研经历与个人优势，或直接粘贴岗位招聘 JD"
                  autoSize={{ minRows: 3, maxRows: 8 }}
                />
              </div>

              <div>
                <div className="muted" style={{ fontSize: 12, marginBottom: 6 }}>
                  快捷模板：
                </div>
                <Space wrap size={[6, 6]}>
                  {TEMPLATES.map((tmpl) => (
                    <Button
                      key={tmpl.label}
                      size="small"
                      onClick={() => {
                        setRequirement(tmpl.text)
                        if (tmpl.limit) setWordLimit(tmpl.limit)
                      }}
                    >
                      {tmpl.label}
                    </Button>
                  ))}
                </Space>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 500 }}>字数上限：</span>
                <InputNumber
                  min={10}
                  max={5000}
                  step={50}
                  placeholder="不限"
                  value={wordLimit}
                  onChange={(v) => setWordLimit(v ?? undefined)}
                  style={{ width: 140 }}
                />
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 500 }}>语气风格：</span>
                <Segmented
                  value={tone}
                  onChange={(v) => setTone(v as 'formal' | 'concise' | 'warm')}
                  options={[
                    { label: '正式', value: 'formal' },
                    { label: '简洁', value: 'concise' },
                    { label: '真诚', value: 'warm' }
                  ]}
                />
              </div>

              <div>
                <div style={{ marginBottom: 6, fontWeight: 500 }}>选择使用的资料：</div>
                <Radio.Group
                  value={dataMode}
                  onChange={(e) => setDataMode(e.target.value)}
                  style={{ marginBottom: 8 }}
                >
                  <Radio value="all">全部资料</Radio>
                  <Radio value="custom">手动选择</Radio>
                </Radio.Group>

                {dataMode === 'custom' && (
                  <TreeSelect
                    treeData={treeData}
                    value={selectedEntryIds}
                    onChange={(val) => {
                      const ids = (val as string[]).filter((k) => !k.startsWith('cat:'))
                      setSelectedEntryIds(ids)
                    }}
                    treeCheckable
                    showCheckedStrategy={TreeSelect.SHOW_CHILD}
                    placeholder="请选择要参考的资料条目"
                    style={{ width: '100%' }}
                    maxTagCount="responsive"
                    allowClear
                  />
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontWeight: 500 }}>包含基本信息：</span>
                <Switch checked={includeProfile} onChange={setIncludeProfile} />
              </div>

              <Alert
                type="info"
                showIcon
                message="身份证号等敏感信息不会发送给 AI"
                style={{ fontSize: 12, padding: '6px 12px' }}
              />

              <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
                {generating ? (
                  <Button
                    type="primary"
                    danger
                    icon={<StopOutlined />}
                    size="large"
                    block
                    onClick={handleStop}
                  >
                    停止生成
                  </Button>
                ) : (
                  <Button
                    type="primary"
                    icon={<PlayCircleOutlined />}
                    size="large"
                    block
                    disabled={!requirement.trim()}
                    onClick={handleGenerate}
                  >
                    开始生成
                  </Button>
                )}
              </div>
            </Space>
          </Card>
        </Col>

        {/* 右侧输出区（约 60%） */}
        <Col xs={24} md={14}>
          <Card
            title={
              <Space>
                <span>生成结果</span>
                {generating && <Tag color="processing">正在生成…</Tag>}
                {currentSnippetId && <Tag color="blue">正在编辑文案库条目</Tag>}
              </Space>
            }
            size="small"
            style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
            styles={{ body: { flex: 1, display: 'flex', flexDirection: 'column' } }}
          >
            <Input.TextArea
              value={output}
              onChange={(e) => setOutput(e.target.value)}
              placeholder="AI 生成的内容将在此实时流式显示，生成完毕后可直接手动编辑，或在下方提出修改意见让 AI 针对性改写…"
              style={{
                flex: 1,
                minHeight: 240,
                resize: 'none',
                fontFamily: 'inherit',
                fontSize: 14,
                lineHeight: 1.65
              }}
            />

            {/* 对已生成文本提出修改意见面板 */}
            <div
              style={{
                marginTop: 12,
                padding: '10px 12px',
                background: '#f9fbff',
                border: '1px solid #d6e4ff',
                borderRadius: 8
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 8,
                  flexWrap: 'wrap',
                  gap: 6
                }}
              >
                <Space size={6}>
                  <CommentOutlined style={{ color: '#1f4e79' }} />
                  <Typography.Text strong style={{ fontSize: 13, color: '#1f4e79' }}>
                    对当前文本提出修改意见（告别死板套路，指哪改哪）
                  </Typography.Text>
                </Space>
                {history.length > 0 && (
                  <Button
                    size="small"
                    type="link"
                    icon={<RollbackOutlined />}
                    disabled={generating}
                    onClick={handleUndoVersion}
                    style={{ padding: 0, height: 'auto', fontSize: 12 }}
                  >
                    退回上一版 ({history.length})
                  </Button>
                )}
              </div>

              <div style={{ marginBottom: 8 }}>
                <Space wrap size={[6, 6]}>
                  {QUICK_FEEDBACKS.map((qf) => (
                    <Tag
                      key={qf.label}
                      color="blue"
                      style={{ cursor: generating || !output.trim() ? 'not-allowed' : 'pointer', margin: 0, userSelect: 'none' }}
                      onClick={() => {
                        if (generating || !output.trim()) return
                        setRefineFeedback(qf.prompt)
                        handleRefine(qf.prompt)
                      }}
                    >
                      {qf.label}
                    </Tag>
                  ))}
                </Space>
              </div>

              <div style={{ display: 'flex', gap: 8 }}>
                <Input
                  value={refineFeedback}
                  onChange={(e) => setRefineFeedback(e.target.value)}
                  disabled={generating}
                  placeholder="输入具体修改意见（如：开头太死板直接讲我的核心项目经历、不要分三段排比、把第二段压缩成一句话…）后回车"
                  onPressEnter={() => handleRefine()}
                />
                <Button
                  type="primary"
                  icon={<ThunderboltOutlined />}
                  disabled={generating || !output.trim() || !refineFeedback.trim()}
                  onClick={() => handleRefine()}
                >
                  按意见修改
                </Button>
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginTop: 12,
                flexWrap: 'wrap',
                gap: 8
              }}
            >
              <span
                style={{
                  fontSize: 13,
                  color: isOverLimit ? '#ff4d4f' : '#8c8c8c'
                }}
              >
                字数统计：<strong>{charCount}</strong>
                {wordLimit ? ` / ${wordLimit}` : ''}
                {isOverLimit && `（超出 ${charCount - wordLimit} 字）`}
              </span>

              <Space>
                {history.length > 0 && (
                  <Button
                    icon={<RollbackOutlined />}
                    size="small"
                    disabled={generating}
                    onClick={handleUndoVersion}
                  >
                    上一版
                  </Button>
                )}
                <CopyButton text={output} label="复制" />
                <Button
                  icon={<ReloadOutlined />}
                  size="small"
                  disabled={generating || !requirement.trim()}
                  onClick={handleGenerate}
                >
                  重新生成
                </Button>
                <Button
                  type="primary"
                  icon={<SaveOutlined />}
                  size="small"
                  disabled={generating || !output.trim()}
                  onClick={openSaveModal}
                >
                  保存到文案库
                </Button>
              </Space>
            </div>
          </Card>
        </Col>

        {/* 底部文案库 */}
        <Col span={24}>
          <Card
            title={`文案库 (${snippets.length})`}
            size="small"
            extra={
              <span className="muted" style={{ fontSize: 13 }}>
                已保存的生成成果与文案草稿
              </span>
            }
          >
            {snippets.length === 0 ? (
              <Empty description="文案库空空如也，生成文案后点击“保存到文案库”沉淀内容" />
            ) : (
              <List
                size="small"
                itemLayout="horizontal"
                dataSource={snippets}
                renderItem={(s) => {
                  const sCount = s.content.replace(/\s+/g, '').length
                  const dateStr = s.createdAt ? s.createdAt.slice(0, 16).replace('T', ' ') : ''
                  return (
                    <List.Item
                      actions={[
                        <CopyButton key="copy" text={s.content} label="复制" />,
                        <Button
                          key="load"
                          type="text"
                          size="small"
                          icon={<ImportOutlined />}
                          onClick={() => loadSnippet(s)}
                        >
                          载入编辑
                        </Button>,
                        <Popconfirm
                          key="del"
                          title="确定删除此文案？"
                          onConfirm={async () => {
                            await window.api.deleteSnippet(s.id)
                            if (currentSnippetId === s.id) {
                              setCurrentSnippetId(null)
                            }
                            await refresh()
                            message.success('已删除')
                          }}
                        >
                          <Button type="text" size="small" danger icon={<DeleteOutlined />}>
                            删除
                          </Button>
                        </Popconfirm>
                      ]}
                    >
                      <List.Item.Meta
                        title={
                          <Space>
                            <Typography.Text strong>{s.title}</Typography.Text>
                            <span className="muted" style={{ fontSize: 12 }}>
                              {dateStr}
                            </span>
                            <Tag>{sCount} 字</Tag>
                            {s.wordLimit && <Tag color="default">上限 {s.wordLimit}</Tag>}
                          </Space>
                        }
                        description={
                          <div style={{ color: '#595959', fontSize: 13 }}>
                            {s.content.slice(0, 80)}
                            {s.content.length > 80 ? '…' : ''}
                          </div>
                        }
                      />
                    </List.Item>
                  )
                }}
              />
            )}
          </Card>
        </Col>
      </Row>

      <Modal
        open={saveModalOpen}
        title="保存到文案库"
        destroyOnHidden
        onCancel={() => setSaveModalOpen(false)}
        onOk={handleSaveSnippet}
      >
        <Space direction="vertical" style={{ width: '100%', marginTop: 12 }} size={12}>
          <div>
            <div style={{ marginBottom: 4, fontWeight: 500 }}>文案标题：</div>
            <Input
              value={saveTitle}
              onChange={(e) => setSaveTitle(e.target.value)}
              placeholder="请输入标题"
              maxLength={40}
            />
          </div>

          {currentSnippetId && (
            <div>
              <div style={{ marginBottom: 4, fontWeight: 500 }}>保存方式：</div>
              <Radio.Group
                value={saveMode}
                onChange={(e) => setSaveMode(e.target.value)}
              >
                <Radio value="overwrite">覆盖已载入文案</Radio>
                <Radio value="new">另存为新文案</Radio>
              </Radio.Group>
            </div>
          )}
        </Space>
      </Modal>
    </div>
  )
}
