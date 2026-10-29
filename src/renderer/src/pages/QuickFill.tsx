import {
  App,
  Button,
  Card,
  Col,
  Collapse,
  Empty,
  Input,
  List,
  Row,
  Space,
  Tag,
  Tooltip,
  Typography
} from 'antd'
import {
  CloseCircleOutlined,
  CopyOutlined,
  PictureOutlined,
  PushpinFilled,
  PushpinOutlined,
  RobotOutlined,
  ThunderboltOutlined,
  UserOutlined
} from '@ant-design/icons'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FormFillItem } from '@shared/types'
import { errMsg, useApp, useVisibleCategories } from '../store'
import { entryTitle, entryToParagraph, formatValue, visibleFields } from '@shared/categories'
import DynIcon from '../components/DynIcon'
import DocAutoFillCard from '../components/DocAutoFillCard'

const BATCH_FILL_CACHE_KEY = 'personal_profile_batchfill_state_v1'

function loadBatchFillCache(): { fieldsText?: string; batchResults?: FormFillItem[] } {
  try {
    const raw = localStorage.getItem(BATCH_FILL_CACHE_KEY)
    if (!raw) return {}
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result || ''))
    r.onerror = () => reject(new Error('读取图片失败'))
    r.readAsDataURL(blob)
  })
}

interface Props {
  isVisible?: boolean
}

export default function QuickFill({ isVisible = true }: Props) {
  const { message } = App.useApp()
  const { db, profileDef, miniMode, toggleMiniMode, setQuickFillStatus } = useApp()
  const visibleCats = useVisibleCategories()
  const [kw, setKw] = useState('')

  const cached = useRef(loadBatchFillCache()).current

  // AI 批量填表助手状态（跨页面 & 重启持久化）
  const [fieldsText, setFieldsText] = useState(cached.fieldsText ?? '')
  const [imageDataUrl, setImageDataUrl] = useState<string | null>(null)
  const [batchLoading, setBatchLoading] = useState(false)
  const [batchResults, setBatchResults] = useState<FormFillItem[]>(cached.batchResults ?? [])

  // 子组件（智能文件填表）后台运行状态
  const [docBusy, setDocBusy] = useState(false)
  const [docSlotCount, setDocSlotCount] = useState(0)

  const isVisibleRef = useRef(isVisible)
  useEffect(() => {
    isVisibleRef.current = isVisible
  }, [isVisible])

  useEffect(() => {
    try {
      localStorage.setItem(BATCH_FILL_CACHE_KEY, JSON.stringify({ fieldsText, batchResults }))
    } catch {
      // ignore
    }
  }, [fieldsText, batchResults])

  const handleDocStatusChange = useCallback((busy: boolean, pendingCount: number) => {
    setDocBusy(busy)
    setDocSlotCount(pendingCount)
  }, [])

  useEffect(() => {
    setQuickFillStatus(docBusy || batchLoading, docSlotCount + batchResults.length)
  }, [docBusy, batchLoading, docSlotCount, batchResults.length, setQuickFillStatus])

  const k = kw.trim().toLowerCase()

  // 复制文本提示
  const copyValue = async (text: string, label: string) => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      message.success(`已复制：${label}`)
    } catch {
      message.error('复制失败')
    }
  }

  // 敏感字段打码（复制仍为明文）
  const maskSensitive = (val: string): string => {
    if (!val) return ''
    if (val.length <= 7) return '•'.repeat(val.length)
    return val.slice(0, 3) + '••••••••' + val.slice(-4)
  }

  // AI 批量填表执行
  const handleBatchFill = async () => {
    if (!fieldsText.trim() && !imageDataUrl) {
      message.warning('请粘贴需要填写的表格栏目名称，或上传/粘贴一张表格截图')
      return
    }
    setBatchLoading(true)
    try {
      const items = await window.api.batchFillForm({
        fieldsText: fieldsText.trim() || undefined,
        imageDataUrl: imageDataUrl || undefined
      })
      setBatchResults(items)
      const prefix = !isVisibleRef.current ? '【后台填表完成】' : ''
      if (items.length === 0) {
        message.info(`${prefix}未能识别出待填字段，请补充更清晰的栏目名`)
      } else {
        message.success(`${prefix}已智能匹配 ${items.length} 个填表项`)
      }
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setBatchLoading(false)
    }
  }

  const pickFormImage = async () => {
    try {
      const paths = await window.api.pickFiles({ images: true, multi: false })
      if (!paths.length) return
      const payload = await window.api.readFileForParse(paths[0])
      if (payload.kind === 'image') {
        setImageDataUrl(payload.dataUrl)
        message.success('已加载表格截图')
      } else {
        message.warning('请选择图片格式文件')
      }
    } catch (e) {
      message.error(errMsg(e))
    }
  }

  // 「常用组合」
  const combos = useMemo(() => {
    const eduList = (db?.entries ?? [])
      .filter((e) => e.category === 'education')
      .sort((a, b) => a.order - b.order)
    const firstEdu = eduList[0]
    const school = formatValue(firstEdu?.data?.school)
    const major = formatValue(firstEdu?.data?.major)
    const degree = formatValue(firstEdu?.data?.degree)
    const eduCombo = [school, major, degree].filter(Boolean).join(' ')

    const phone = formatValue(db?.profile?.data?.phone)
    const email = formatValue(db?.profile?.data?.email)
    const contactCombo = [phone, email].filter(Boolean).join(' / ')

    const awardList = (db?.entries ?? [])
      .filter((e) => e.category === 'award')
      .sort((a, b) => a.order - b.order)
    const awardsCombo = awardList
      .map((e) => {
        const d = formatValue(e.data.date)
        const n = formatValue(e.data.name)
        const r = formatValue(e.data.rank) || formatValue(e.data.level)
        return [d, n, r].filter(Boolean).join(' ')
      })
      .filter(Boolean)
      .join('\n')

    const certList = (db?.entries ?? [])
      .filter((e) => e.category === 'certificate')
      .sort((a, b) => a.order - b.order)
    const certsCombo = certList
      .map((e) => {
        const n = formatValue(e.data.name)
        const s = formatValue(e.data.score)
        return [n, s].filter(Boolean).join(' ')
      })
      .filter(Boolean)
      .join('\n')

    const skillList = (db?.entries ?? [])
      .filter((e) => e.category === 'skill')
      .sort((a, b) => a.order - b.order)
    const skillsCombo = skillList
      .map((e) => formatValue(e.data.name))
      .filter(Boolean)
      .join('、')

    const all = [
      { key: 'edu', label: '最高学历信息', title: '学校 + 专业 + 学历', val: eduCombo },
      { key: 'contact', label: '联系方式', title: '手机 / 邮箱', val: contactCombo },
      { key: 'awards', label: '全部获奖', title: '全部获奖（每行：时间 奖项 名次）', val: awardsCombo, multiline: true },
      { key: 'certs', label: '全部证书', title: '全部证书（每行：证书 成绩）', val: certsCombo, multiline: true },
      { key: 'skills', label: '技能清单', title: '技能清单（、分隔）', val: skillsCombo }
    ]

    return all.filter((c) => Boolean(c.val))
  }, [db?.entries, db?.profile?.data?.email, db?.profile?.data?.phone])

  const filteredCombos = useMemo(() => {
    if (!k) return combos
    return combos.filter(
      (c) => c.label.toLowerCase().includes(k) || c.title.toLowerCase().includes(k) || c.val.toLowerCase().includes(k)
    )
  }, [combos, k])

  const profileItems = useMemo(() => {
    const fields = profileDef ? visibleFields(profileDef) : []
    const items = fields
      .map((f) => {
        const raw = db?.profile?.data?.[f.key]
        const text = formatValue(raw)
        return {
          key: f.key,
          label: f.label,
          sensitive: f.sensitive,
          text
        }
      })
      .filter((item) => Boolean(item.text))

    if (!k) return items
    return items.filter(
      (item) => item.label.toLowerCase().includes(k) || item.text.toLowerCase().includes(k)
    )
  }, [db?.profile?.data, profileDef, k])

  return (
    <div className="page">
      <div className="page-header" style={{ flexWrap: 'wrap', gap: 8 }}>
        <h2>
          <ThunderboltOutlined /> 快速填表
        </h2>
        <Space wrap>
          <Input.Search
            placeholder="搜索字段名或内容…"
            allowClear
            value={kw}
            onChange={(e) => setKw(e.target.value)}
            style={{ width: miniMode ? 180 : 260 }}
          />
          <Tooltip title={miniMode ? '恢复常规大窗口并取消置顶' : '收缩为右侧 400px 置顶悬浮条，边看网页网申系统边复制'}>
            <Button
              type={miniMode ? 'primary' : 'default'}
              icon={miniMode ? <PushpinFilled /> : <PushpinOutlined />}
              onClick={() => toggleMiniMode()}
            >
              {miniMode ? '退出小窗置顶' : '📌 置顶悬浮小窗'}
            </Button>
          </Tooltip>
        </Space>
      </div>

      {!miniMode && (
        <Typography.Paragraph type="secondary" style={{ marginBottom: 16 }}>
          针对文件报名表与网页网申系统设计：可上传需填写的 Word/文本表格让 AI 自动检索文献与资料库直接填写文件，也可开启右上角「置顶悬浮小窗」浮于浏览器旁一键复制。
        </Typography.Paragraph>
      )}

      {/* 智能文件填表（给出需要填写的文件 -> 检索文献库与资料库填写 -> 查不到询问并记录 -> 原文件覆盖或新文件保存） */}
      <DocAutoFillCard isVisible={isVisible} onStatusChange={handleDocStatusChange} />

      {/* AI 批量填表助手 */}
      <Card
        size="small"
        style={{ marginBottom: 20, borderColor: '#d6e4ff', background: '#f9fbff' }}
        title={
          <Space>
            <RobotOutlined style={{ color: '#1f4e79' }} />
            <span>🤖 AI 批量填表助手（粘贴表格栏目或截图）</span>
          </Space>
        }
        extra={
          batchResults.length > 0 && (
            <Button
              size="small"
              type="link"
              icon={<CopyOutlined />}
              onClick={() => {
                const tsv = batchResults.map((r) => `${r.field}\t${r.value}`).join('\n')
                copyValue(tsv, '全部填表项（Excel TSV 格式）')
              }}
            >
              一键复制全部（Excel 格式）
            </Button>
          )
        }
      >
        <div
          onPaste={async (e) => {
            const items = Array.from(e.clipboardData?.items ?? [])
            const imgItem = items.find((it) => it.type.startsWith('image/'))
            if (imgItem) {
              const f = imgItem.getAsFile()
              if (f) {
                const url = await blobToDataUrl(f)
                setImageDataUrl(url)
                message.success('已粘贴表格截图')
              }
            }
          }}
        >
          <Input.TextArea
            rows={miniMode ? 2 : 3}
            value={fieldsText}
            onChange={(e) => setFieldsText(e.target.value)}
            placeholder="粘贴网页或 Excel 表单的栏目名（每行或逗号分隔，例如：姓名、政治面貌、最高学历、毕业院校、GPA、代表性获奖、200字个人简介），也可直接按 Ctrl+V 粘贴网申表单截图…"
          />
          {imageDataUrl && (
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
              <img
                src={imageDataUrl}
                alt="表单截图"
                style={{ height: 52, borderRadius: 4, border: '1px solid #d9d9d9' }}
              />
              <Button
                size="small"
                type="text"
                danger
                icon={<CloseCircleOutlined />}
                onClick={() => setImageDataUrl(null)}
              >
                移除截图
              </Button>
            </div>
          )}
          <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <Button size="small" icon={<PictureOutlined />} onClick={pickFormImage}>
              选择表单截图
            </Button>
            <Space>
              {batchResults.length > 0 && (
                <Button size="small" onClick={() => setBatchResults([])}>
                  清空结果
                </Button>
              )}
              <Button
                size="small"
                type="primary"
                icon={<RobotOutlined />}
                loading={batchLoading}
                onClick={handleBatchFill}
              >
                AI 一键匹配填表答案
              </Button>
            </Space>
          </div>

          {batchResults.length > 0 && (
            <List
              size="small"
              style={{ marginTop: 12, background: '#fff', borderRadius: 6, border: '1px solid #e8e8e8' }}
              dataSource={batchResults}
              renderItem={(item, idx) => (
                <List.Item
                  style={{ padding: '8px 12px' }}
                  actions={[
                    <Button
                      key="cp"
                      size="small"
                      type="primary"
                      ghost
                      icon={<CopyOutlined />}
                      onClick={() => copyValue(item.value, item.field)}
                    >
                      复制
                    </Button>
                  ]}
                >
                  <div style={{ width: '100%', paddingRight: 8 }}>
                    <Space size={6} wrap style={{ marginBottom: 4 }}>
                      <Typography.Text strong style={{ fontSize: 13 }}>
                        {item.field}
                      </Typography.Text>
                      {item.note && (
                        <Tag color={item.value ? 'blue' : 'warning'} style={{ fontSize: 11 }}>
                          {item.note}
                        </Tag>
                      )}
                    </Space>
                    <Input.TextArea
                      autoSize={{ minRows: 1, maxRows: 4 }}
                      value={item.value}
                      placeholder="资料库中暂无对应值，可在此手动补充后复制"
                      onChange={(e) => {
                        const val = e.target.value
                        setBatchResults((prev) =>
                          prev.map((it, i) => (i === idx ? { ...it, value: val } : it))
                        )
                      }}
                      style={{ fontSize: 13 }}
                    />
                  </div>
                </List.Item>
              )}
            />
          )}
        </div>
      </Card>

      {/* 常用组合区 */}
      {filteredCombos.length > 0 && (
        <Card
          title="常用组合"
          size="small"
          style={{ marginBottom: 20 }}
          extra={<span className="muted" style={{ fontSize: 12 }}>自动拼接，点击即复制</span>}
        >
          <Row gutter={[12, 12]}>
            {filteredCombos.map((c) => (
              <Col xs={24} sm={miniMode ? 24 : 12} md={miniMode ? 24 : 8} lg={miniMode ? 24 : c.multiline ? 12 : 8} key={c.key}>
                <Card
                  size="small"
                  hoverable
                  style={{ cursor: 'pointer', height: '100%', background: '#fcfdfe' }}
                  onClick={() => copyValue(c.val, c.label)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <Typography.Text strong style={{ fontSize: 13, color: '#1f4e79' }}>
                      {c.title}
                    </Typography.Text>
                    <CopyOutlined style={{ color: '#8c8c8c' }} />
                  </div>
                  <div
                    className={c.multiline ? 'pre-wrap' : ''}
                    style={{
                      fontSize: 13,
                      color: '#262626',
                      maxHeight: c.multiline ? 120 : 'auto',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}
                  >
                    {c.val}
                  </div>
                </Card>
              </Col>
            ))}
          </Row>
        </Card>
      )}

      {/* 基本信息区 */}
      <Card
        title={
          <Space>
            <UserOutlined />
            <span>基本信息</span>
          </Space>
        }
        size="small"
        style={{ marginBottom: 20 }}
      >
        {profileItems.length === 0 ? (
          <Empty description={k ? '未找到匹配的基本信息' : '暂无已填写的基本信息'} />
        ) : (
          <Row gutter={[12, 12]}>
            {profileItems.map((item) => (
              <Col xs={24} sm={miniMode ? 12 : 12} md={miniMode ? 12 : 8} lg={miniMode ? 12 : 6} key={item.key}>
                <Card
                  size="small"
                  hoverable
                  style={{
                    cursor: 'pointer',
                    height: '100%',
                    background: '#fafafa',
                    borderColor: '#f0f0f0'
                  }}
                  onClick={() => copyValue(item.text, item.label)}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                    <span className="muted" style={{ fontSize: 12 }}>
                      {item.label}
                    </span>
                    <CopyOutlined style={{ color: '#bfbfbf', fontSize: 12 }} />
                  </div>
                  <div
                    style={{
                      fontWeight: 500,
                      wordBreak: 'break-all',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}
                  >
                    {item.sensitive ? maskSensitive(item.text) : item.text}
                  </div>
                </Card>
              </Col>
            ))}
          </Row>
        )}
      </Card>

      {/* 可见分类区 */}
      {visibleCats.map((cat) => {
        const catEntries = (db?.entries ?? [])
          .filter((e) => e.category === cat.id)
          .sort((a, b) => a.order - b.order)

        const fields = visibleFields(cat)

        const filteredEntries = catEntries.filter((entry) => {
          if (!k) return true
          const t = entryTitle(cat, entry.data).toLowerCase()
          if (t.includes(k)) return true
          for (const f of fields) {
            const v = formatValue(entry.data[f.key]).toLowerCase()
            if (f.label.toLowerCase().includes(k) || v.includes(k)) return true
          }
          return false
        })

        if (catEntries.length === 0 && !k) return null
        if (filteredEntries.length === 0) return null

        const collapseItems = filteredEntries.map((entry) => {
          const title = entryTitle(cat, entry.data)
          const paragraph = entryToParagraph(cat, entry.data)

          const filledFields = fields
            .map((f) => ({
              key: f.key,
              label: f.label,
              sensitive: f.sensitive,
              text: formatValue(entry.data[f.key])
            }))
            .filter((f) => Boolean(f.text))

          return {
            key: entry.id,
            label: (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  width: '100%',
                  paddingRight: 8
                }}
              >
                <Space wrap>
                  <Typography.Text strong>{title}</Typography.Text>
                  {entry.tags?.map((t) => (
                    <Tag key={t}>{t}</Tag>
                  ))}
                </Space>
                <Button
                  size="small"
                  type="primary"
                  ghost
                  icon={<CopyOutlined />}
                  onClick={(ev) => {
                    ev.stopPropagation()
                    copyValue(paragraph, `${cat.label} - ${title}`)
                  }}
                >
                  复制整段
                </Button>
              </div>
            ),
            children: (
              <Row gutter={[10, 10]}>
                {filledFields.map((f) => (
                  <Col xs={24} sm={miniMode ? 24 : 12} md={miniMode ? 24 : 8} lg={miniMode ? 24 : 6} key={f.key}>
                    <div
                      onClick={() => copyValue(f.text, f.label)}
                      style={{
                        padding: '8px 12px',
                        borderRadius: 6,
                        border: '1px solid #e8e8e8',
                        background: '#ffffff',
                        cursor: 'pointer',
                        transition: 'all 0.2s'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = '#1f4e79'
                        e.currentTarget.style.background = '#f7fafc'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = '#e8e8e8'
                        e.currentTarget.style.background = '#ffffff'
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          marginBottom: 4
                        }}
                      >
                        <span className="muted" style={{ fontSize: 12 }}>
                          {f.label}
                        </span>
                        <CopyOutlined style={{ fontSize: 11, color: '#bfbfbf' }} />
                      </div>
                      <div
                        style={{
                          fontSize: 13,
                          fontWeight: 500,
                          wordBreak: 'break-all',
                          whiteSpace: 'pre-wrap'
                        }}
                      >
                        {f.sensitive ? maskSensitive(f.text) : f.text}
                      </div>
                    </div>
                  </Col>
                ))}
              </Row>
            )
          }
        })

        return (
          <Card
            key={cat.id}
            title={
              <Space>
                <DynIcon name={cat.icon} />
                <span>{cat.label}</span>
                <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>
                  ({filteredEntries.length} 条)
                </span>
              </Space>
            }
            size="small"
            style={{ marginBottom: 20 }}
          >
            <Collapse items={collapseItems} defaultActiveKey={filteredEntries.map((e) => e.id)} />
          </Card>
        )
      })}
    </div>
  )
}
