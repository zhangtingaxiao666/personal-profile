import {
  Alert,
  App,
  Card,
  Col,
  List,
  Progress,
  Row,
  Space,
  Tag,
  Typography,
  Button,
  Empty
} from 'antd'
import {
  RobotOutlined,
  EditOutlined,
  ThunderboltOutlined,
  UserOutlined,
  RightOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  MergeCellsOutlined,
  PaperClipOutlined,
  SwapOutlined,
  WarningOutlined
} from '@ant-design/icons'
import { useMemo, useState } from 'react'
import dayjs from 'dayjs'
import { errMsg, useApp, useVisibleCategories } from '../store'
import DynIcon from '../components/DynIcon'
import { entryTitle, formatValue } from '@shared/categories'
import { type ConflictWarning, scanDatabaseConflicts } from '@shared/diagnostics'

interface Props {
  navigate: (k: string) => void
}

interface IssueItem {
  id: string
  title: string
  desc: string
  target: string
  tag: string
}

export default function Dashboard({ navigate }: Props) {
  const { message } = App.useApp()
  const { db, categories: allCats, profileDef, refresh } = useApp()
  const visibleCats = useVisibleCategories()
  const [resolvingId, setResolvingId] = useState<string | null>(null)

  const handleResolveWarning = async (
    w: ConflictWarning,
    mode: 'merge' | 'combined' | 'incoming' | 'existing' | 'swap_time'
  ) => {
    if (!db) return
    setResolvingId(w.id)
    try {
      if (mode === 'swap_time' && w.entryIds.length === 1) {
        const entry = db.entries.find((e) => e.id === w.entryIds[0])
        if (entry) {
          await window.api.upsertEntry({
            id: entry.id,
            category: entry.category,
            data: { ...entry.data, start: entry.data.end, end: entry.data.start },
            tags: entry.tags
          })
          await refresh()
          message.success('已一键对调起止时间并修复时间线异常')
        }
        return
      }

      if (w.entryIds.length >= 2) {
        const [primaryId, secondaryId] = w.entryIds
        let overrides: Record<string, unknown> | undefined
        if (w.conflictFieldKey) {
          if (mode === 'combined' && w.combinedValue) {
            overrides = { [w.conflictFieldKey]: w.combinedValue }
          } else if (mode === 'incoming' && w.incomingValue) {
            overrides = { [w.conflictFieldKey]: w.incomingValue }
          } else if (mode === 'existing' && w.existingValue) {
            overrides = { [w.conflictFieldKey]: w.existingValue }
          }
        }
        await window.api.mergeEntries(primaryId, secondaryId, overrides)
        await refresh()
        message.success(
          mode === 'combined'
            ? `已并列保留双值（${w.combinedValue}）并无损合并两条记录与附件`
            : mode === 'incoming'
              ? `已采用「${w.incomingValue}」并无损合并两条记录与附件`
              : mode === 'existing'
                ? `已保留「${w.existingValue}」并无损合并两条记录与附件`
                : '已一键无损合并两条重复记录及其全部附件'
        )
      }
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setResolvingId(null)
    }
  }

  const profileData = db?.profile?.data ?? {}
  const profileName = formatValue(profileData.name)
  const profilePhone = formatValue(profileData.phone)
  const profileEmail = formatValue(profileData.email)

  // 自动扫描资料库中的重复条目与冲突条目（含成绩分制计算方式不同 vs 不同学期冲突）
  const conflictWarnings = useMemo(() => (db ? scanDatabaseConflicts(db) : []), [db])

  // 待完善提示规则检查与完整度计算
  const { completeness, issues } = useMemo(() => {
    let totalChecks = 0
    let passedChecks = 0
    const list: IssueItem[] = []

    // 1. 基本信息中 姓名/手机号/邮箱
    totalChecks++
    if (profileName) {
      passedChecks++
    } else {
      list.push({
        id: 'p_name',
        title: '基本信息缺少「姓名」',
        desc: '姓名是个人画像的核心标识，请先补充',
        target: 'profile',
        tag: '基本信息'
      })
    }

    totalChecks++
    if (profilePhone) {
      passedChecks++
    } else {
      list.push({
        id: 'p_phone',
        title: '基本信息缺少「手机号」',
        desc: '联系方式是填表与简历的必要信息',
        target: 'profile',
        tag: '基本信息'
      })
    }

    totalChecks++
    if (profileEmail) {
      passedChecks++
    } else {
      list.push({
        id: 'p_email',
        title: '基本信息缺少「邮箱」',
        desc: '常用邮箱便于投递与沟通',
        target: 'profile',
        tag: '基本信息'
      })
    }

    // 2. 分类条目规则检查
    for (const cat of visibleCats) {
      const catEntries = (db?.entries ?? []).filter((e) => e.category === cat.id)
      const reqFields = cat.fields.filter((f) => f.required && !f.hidden)
      const hasTimeField = cat.fields.some((f) => (f.key === 'start' || f.key === 'end') && !f.hidden)

      for (const entry of catEntries) {
        const title = entryTitle(cat, entry.data)

        // 分类中 required 字段缺失的条目
        for (const rf of reqFields) {
          totalChecks++
          if (formatValue(entry.data[rf.key])) {
            passedChecks++
          } else {
            list.push({
              id: `req_${entry.id}_${rf.key}`,
              title: `「${title}」缺少必填字段「${rf.label}」`,
              desc: `【${cat.label}】条目未填写 ${rf.label}`,
              target: `cat:${cat.id}`,
              tag: cat.label
            })
          }
        }

        // 有 start/end 字段定义但两者都空的条目
        if (hasTimeField) {
          totalChecks++
          if (formatValue(entry.data.start) || formatValue(entry.data.end)) {
            passedChecks++
          } else {
            list.push({
              id: `time_${entry.id}`,
              title: `「${title}」缺少时间`,
              desc: `【${cat.label}】未填写开始时间或结束时间`,
              target: `cat:${cat.id}`,
              tag: cat.label
            })
          }
        }

        // award 和 certificate 分类中没有证明文件的条目
        if (cat.id === 'award' || cat.id === 'certificate') {
          totalChecks++
          if (entry.attachments && entry.attachments.length > 0) {
            passedChecks++
          } else {
            list.push({
              id: `att_${entry.id}`,
              title: `「${title}」缺少证明文件`,
              desc: `【${cat.label}】建议补充获奖证书或资质文件作为证明`,
              target: `cat:${cat.id}`,
              tag: cat.label
            })
          }
        }

        // project/work 条目没有 achievements
        if (cat.id === 'project' || cat.id === 'work') {
          totalChecks++
          if (formatValue(entry.data.achievements)) {
            passedChecks++
          } else {
            list.push({
              id: `ach_${entry.id}`,
              title: `「${title}」建议补充成果/量化指标`,
              desc: `【${cat.label}】补充工作成果或量化数据更有说服力`,
              target: `cat:${cat.id}`,
              tag: cat.label
            })
          }
        }
      }
    }

    const pct = totalChecks > 0 ? Math.round((passedChecks / totalChecks) * 100) : 100
    return { completeness: pct, issues: list }
  }, [db?.entries, profileEmail, profileName, profilePhone, visibleCats])

  // 最近更新的 5 条条目
  const recentEntries = useMemo(() => {
    return [...(db?.entries ?? [])]
      .sort((a, b) => (b.updatedAt || b.createdAt || '').localeCompare(a.updatedAt || a.createdAt || ''))
      .slice(0, 5)
  }, [db?.entries])

  // 基本信息已填字段数
  const profileFilledCount = useMemo(() => {
    const fields = profileDef?.fields ?? []
    return fields.filter((f) => formatValue(profileData[f.key])).length
  }, [profileDef?.fields, profileData])

  return (
    <div className="page">
      {/* 顶部欢迎语与进度 */}
      <Card style={{ marginBottom: 20 }}>
        <Row gutter={[24, 16]} align="middle">
          <Col xs={24} md={14}>
            <Typography.Title level={3} style={{ margin: 0 }}>
              {profileName ? `你好，${profileName}` : '欢迎使用个人画像'}
            </Typography.Title>
            <Typography.Paragraph type="secondary" style={{ margin: '8px 0 0 0' }}>
              {profileName
                ? '你的个人资料库已就绪，保持信息完整可让文案生成和填表更高效。'
                : '请先前往「基本信息」完善你的姓名与联系方式。'}
            </Typography.Paragraph>
          </Col>
          <Col xs={24} md={10}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontWeight: 500 }}>资料完整度</span>
              <span className="muted" style={{ fontSize: 13 }}>
                {completeness}%
              </span>
            </div>
            <Progress
              percent={completeness}
              status={completeness === 100 ? 'success' : 'normal'}
              strokeColor={completeness === 100 ? '#52c41a' : '#1f4e79'}
            />
          </Col>
        </Row>
      </Card>

      {/* 重复条目与数据冲突告警（含成绩分制不同 vs 不同学期成绩冲突提示） */}
      {conflictWarnings.length > 0 && (
        <Alert
          type="warning"
          showIcon
          icon={<WarningOutlined />}
          style={{ marginBottom: 20 }}
          message={
            <Space>
              <Typography.Text strong>
                检测到 {conflictWarnings.length} 项重复或冲突条目（如成绩分制计算方式不同 / 不同学期成绩冲突）
              </Typography.Text>
              <Tag color="red">{conflictWarnings.length} 项需核对</Tag>
            </Space>
          }
          description={
            <List
              size="small"
              dataSource={conflictWarnings}
              renderItem={(w) => (
                <List.Item
                  style={{ padding: '8px 0' }}
                  actions={[
                    <Button
                      key="go"
                      size="small"
                      type="link"
                      icon={<RightOutlined />}
                      onClick={() => navigate('cat:' + w.categoryId)}
                    >
                      查看详情
                    </Button>
                  ]}
                >
                  <Space direction="vertical" size={4} style={{ width: '100%' }}>
                    <Space wrap>
                      <Tag color={w.kind === 'conflict' ? 'red' : w.kind === 'duplicate' ? 'orange' : 'purple'}>
                        {w.kind === 'conflict' ? '字段/成绩冲突' : w.kind === 'duplicate' ? '疑似重复' : '时间线异常'}
                      </Tag>
                      <Typography.Text strong>{w.title}</Typography.Text>
                    </Space>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {w.detail}
                    </Typography.Text>
                    {/* 一键原地消解按钮组 */}
                    <Space wrap size={6} style={{ marginTop: 2 }}>
                      {w.kind === 'conflict' && w.entryIds.length >= 2 && (
                        <>
                          {w.combinedValue && (
                            <Button
                              size="small"
                              type="primary"
                              icon={<MergeCellsOutlined />}
                              loading={resolvingId === w.id}
                              onClick={() => handleResolveWarning(w, 'combined')}
                            >
                              并列保留双值并合并（{w.combinedValue}）
                            </Button>
                          )}
                          {w.incomingValue && (
                            <Button
                              size="small"
                              loading={resolvingId === w.id}
                              onClick={() => handleResolveWarning(w, 'incoming')}
                            >
                              采用「{w.incomingValue}」并合并
                            </Button>
                          )}
                          {w.existingValue && (
                            <Button
                              size="small"
                              loading={resolvingId === w.id}
                              onClick={() => handleResolveWarning(w, 'existing')}
                            >
                              保留「{w.existingValue}」并合并
                            </Button>
                          )}
                        </>
                      )}
                      {w.kind === 'duplicate' && w.entryIds.length >= 2 && (
                        <Button
                          size="small"
                          type="primary"
                          icon={<MergeCellsOutlined />}
                          loading={resolvingId === w.id}
                          onClick={() => handleResolveWarning(w, 'merge')}
                        >
                          ⚡ 一键合并两条目（保留全部字段与附件）
                        </Button>
                      )}
                      {w.kind === 'timeline' && w.entryIds.length === 1 && (
                        <Button
                          size="small"
                          type="primary"
                          icon={<SwapOutlined />}
                          loading={resolvingId === w.id}
                          onClick={() => handleResolveWarning(w, 'swap_time')}
                        >
                          ⚡ 一键对调起止时间
                        </Button>
                      )}
                    </Space>
                  </Space>
                </List.Item>
              )}
            />
          }
        />
      )}

      {/* 快捷操作按钮 */}
      <div style={{ marginBottom: 20 }}>
        <Space wrap size={12}>
          <Button type="primary" icon={<RobotOutlined />} onClick={() => navigate('ai-import')}>
            AI 整理导入
          </Button>
          <Button icon={<EditOutlined />} onClick={() => navigate('generator')}>
            文案生成
          </Button>
          <Button icon={<ThunderboltOutlined />} onClick={() => navigate('quickfill')}>
            快速填表
          </Button>
        </Space>
      </div>

      {/* 统计卡片网格 */}
      <Typography.Title level={4} style={{ marginBottom: 12 }}>
        资料统计
      </Typography.Title>
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        {/* 基本信息卡片 */}
        <Col xs={24} sm={12} md={8} lg={6}>
          <Card
            hoverable
            onClick={() => navigate('profile')}
            style={{ height: '100%', cursor: 'pointer' }}
          >
            <Space align="center" style={{ marginBottom: 8 }}>
              <UserOutlined style={{ fontSize: 20, color: '#1f4e79' }} />
              <Typography.Text strong style={{ fontSize: 16 }}>
                基本信息
              </Typography.Text>
            </Space>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
              <span className="muted">已填字段</span>
              <Typography.Text strong>{profileFilledCount}</Typography.Text>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
              <span className="muted">证明文件</span>
              <Typography.Text strong>{db?.profile.attachments.length ?? 0}</Typography.Text>
            </div>
          </Card>
        </Col>

        {/* 每个可见分类卡片 */}
        {visibleCats.map((cat) => {
          const entries = (db?.entries ?? []).filter((e) => e.category === cat.id)
          const attachCount = entries.reduce((acc, cur) => acc + (cur.attachments?.length ?? 0), 0)
          return (
            <Col xs={24} sm={12} md={8} lg={6} key={cat.id}>
              <Card
                hoverable
                onClick={() => navigate('cat:' + cat.id)}
                style={{ height: '100%', cursor: 'pointer' }}
              >
                <Space align="center" style={{ marginBottom: 8 }}>
                  <span style={{ fontSize: 20, color: '#1f4e79' }}>
                    <DynIcon name={cat.icon} />
                  </span>
                  <Typography.Text strong style={{ fontSize: 16 }}>
                    {cat.label}
                  </Typography.Text>
                </Space>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12 }}>
                  <span className="muted">条目数</span>
                  <Typography.Text strong>{entries.length}</Typography.Text>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4 }}>
                  <span className="muted">证明文件</span>
                  <Typography.Text strong>{attachCount}</Typography.Text>
                </div>
              </Card>
            </Col>
          )
        })}
      </Row>

      <Row gutter={[20, 20]}>
        {/* 待完善提示列表 */}
        <Col xs={24} lg={14}>
          <Card
            title={
              <Space>
                <ExclamationCircleOutlined style={{ color: issues.length ? '#faad14' : '#52c41a' }} />
                <span>待完善提示</span>
                {issues.length > 0 && <Tag color="warning">{issues.length}</Tag>}
              </Space>
            }
            style={{ height: '100%' }}
          >
            {issues.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  <Space orientation="vertical" size={2}>
                    <Typography.Text style={{ color: '#52c41a', fontWeight: 500 }}>
                      <CheckCircleOutlined /> 资料十分完整
                    </Typography.Text>
                    <span className="muted">未发现缺失必填项或建议补充项</span>
                  </Space>
                }
              />
            ) : (
              <List
                size="small"
                dataSource={issues}
                renderItem={(item) => (
                  <List.Item
                    style={{ cursor: 'pointer', padding: '10px 8px', borderRadius: 6 }}
                    onClick={() => navigate(item.target)}
                    actions={[<RightOutlined key="go" style={{ fontSize: 12, color: '#bfbfbf' }} />]}
                  >
                    <List.Item.Meta
                      title={
                        <Space wrap>
                          <Tag color="orange">{item.tag}</Tag>
                          <Typography.Text strong>{item.title}</Typography.Text>
                        </Space>
                      }
                      description={<span className="muted">{item.desc}</span>}
                    />
                  </List.Item>
                )}
              />
            )}
          </Card>
        </Col>

        {/* 最近更新条目 */}
        <Col xs={24} lg={10}>
          <Card
            title={
              <Space>
                <ClockCircleOutlined />
                <span>最近更新</span>
              </Space>
            }
            style={{ height: '100%' }}
          >
            {recentEntries.length === 0 ? (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无近期修改记录" />
            ) : (
              <List
                size="small"
                dataSource={recentEntries}
                renderItem={(item) => {
                  const cat =
                    visibleCats.find((c) => c.id === item.category) ||
                    allCats.find((c) => c.id === item.category)
                  const title = entryTitle(cat, item.data)
                  const time = item.updatedAt || item.createdAt
                  return (
                    <List.Item
                      style={{ cursor: 'pointer', padding: '10px 8px', borderRadius: 6 }}
                      onClick={() => navigate('cat:' + item.category)}
                      actions={[
                        item.attachments?.length > 0 && (
                          <Tag icon={<PaperClipOutlined />} color="blue" key="att">
                            {item.attachments.length}
                          </Tag>
                        ),
                        <RightOutlined key="go" style={{ fontSize: 12, color: '#bfbfbf' }} />
                      ].filter(Boolean)}
                    >
                      <List.Item.Meta
                        avatar={
                          <span style={{ fontSize: 18, color: '#1f4e79', lineHeight: '32px' }}>
                            <DynIcon name={cat?.icon ?? 'FolderOutlined'} />
                          </span>
                        }
                        title={
                          <Space>
                            <Typography.Text strong ellipsis style={{ maxWidth: 160 }}>
                              {title}
                            </Typography.Text>
                            <Tag>{cat?.label ?? item.category}</Tag>
                          </Space>
                        }
                        description={
                          <span className="muted" style={{ fontSize: 12 }}>
                            {time ? dayjs(time).format('YYYY-MM-DD HH:mm') : ''}
                          </span>
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
    </div>
  )
}
