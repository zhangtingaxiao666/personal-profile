import { Alert, App, Button, Card, Empty, Input, Popconfirm, Select, Space, Tag, Tooltip, Typography } from 'antd'
import { ArrowDownOutlined, ArrowUpOutlined, DeleteOutlined, EditOutlined, MergeCellsOutlined, PaperClipOutlined, PlusOutlined, RobotOutlined, SwapOutlined, WarningOutlined } from '@ant-design/icons'
import { useMemo, useState } from 'react'
import type { CategoryDef, Entry } from '@shared/types'
import { entryTitle, entryToParagraph, formatValue, periodText, visibleFields } from '@shared/categories'
import { type ConflictWarning, scanDatabaseConflicts } from '@shared/diagnostics'
import { errMsg, useApp } from '../store'
import CopyButton from '../components/CopyButton'
import EntryEditor from '../components/EntryEditor'
import DynIcon from '../components/DynIcon'

/** 通用分类页：卡片列表 + 搜索/标签筛选 + 重复与冲突检测提示 + 排序 + 编辑 */
export default function CategoryPage({ category }: { category: CategoryDef }) {
  const { message } = App.useApp()
  const { db, refresh } = useApp()
  const [editing, setEditing] = useState<Entry | null | undefined>(undefined) // undefined=关闭, null=新建
  const [kw, setKw] = useState('')
  const [tag, setTag] = useState<string | undefined>()

  const all = useMemo(
    () => (db?.entries ?? []).filter((e) => e.category === category.id).sort((a, b) => a.order - b.order),
    [db, category.id]
  )
  const catWarnings = useMemo(
    () => (db ? scanDatabaseConflicts(db).filter((w) => w.categoryId === category.id) : []),
    [db, category.id]
  )
  const conflictEntryIdSet = useMemo(
    () => new Set(catWarnings.flatMap((w) => w.entryIds)),
    [catWarnings]
  )

  const tags = [...new Set(all.flatMap((e) => e.tags))]
  const list = all.filter(
    (e) =>
      (!tag || e.tags.includes(tag)) &&
      (!kw || JSON.stringify(e.data).toLowerCase().includes(kw.toLowerCase()) || e.tags.some((t) => t.includes(kw)))
  )
  const filtered = !!kw || !!tag

  const move = async (idx: number, dir: -1 | 1) => {
    const ids = all.map((e) => e.id)
    const j = idx + dir
    if (j < 0 || j >= ids.length) return
    ;[ids[idx], ids[j]] = [ids[j], ids[idx]]
    await window.api.reorderEntries(category.id, ids)
    refresh()
  }

  const handleResolveWarning = async (
    w: ConflictWarning,
    mode: 'merge' | 'combined' | 'incoming' | 'existing' | 'swap_time'
  ) => {
    if (!db) return
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
          message.success('已一键对调起止时间')
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
        message.success('已一键合并条目并消解冲突')
      }
    } catch (e) {
      message.error(errMsg(e))
    }
  }

  const fields = visibleFields(category)
  const skip = new Set([category.titleField, ...(category.subtitleFields ?? []), 'start', 'end', 'date'])

  return (
    <div className="page">
      <div className="page-header">
        <h2>
          <DynIcon name={category.icon} /> {category.label}
          <span className="muted" style={{ fontSize: 14, fontWeight: 400, marginLeft: 8 }}>
            共 {all.length} 条
          </span>
        </h2>
        <Space>
          <Input.Search placeholder="搜索" allowClear onChange={(e) => setKw(e.target.value)} style={{ width: 200 }} />
          {tags.length > 0 && (
            <Select allowClear placeholder="按标签筛选" value={tag} onChange={setTag} options={tags.map((t) => ({ label: t, value: t }))} style={{ width: 140 }} />
          )}
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing(null)}>
            新建
          </Button>
        </Space>
      </div>

      {catWarnings.length > 0 && (
        <Alert
          type="warning"
          showIcon
          icon={<WarningOutlined />}
          style={{ marginBottom: 16 }}
          message={`当前分类检测到 ${catWarnings.length} 项重复或冲突提示`}
          description={
            <Space direction="vertical" size={8} style={{ width: '100%' }}>
              {catWarnings.map((w) => (
                <div key={w.id} style={{ fontSize: 13 }}>
                  <div>
                    <Tag color={w.kind === 'conflict' ? 'red' : w.kind === 'duplicate' ? 'orange' : 'purple'}>
                      {w.kind === 'conflict' ? '数据/成绩冲突' : w.kind === 'duplicate' ? '疑似重复' : '时间线异常'}
                    </Tag>
                    <Typography.Text strong>{w.title}：</Typography.Text>
                    <Typography.Text type="secondary">{w.detail}</Typography.Text>
                  </div>
                  <Space wrap size={6} style={{ marginTop: 4 }}>
                    {w.kind === 'conflict' && w.entryIds.length >= 2 && (
                      <>
                        {w.combinedValue && (
                          <Button
                            size="small"
                            type="primary"
                            icon={<MergeCellsOutlined />}
                            onClick={() => handleResolveWarning(w, 'combined')}
                          >
                            并列保留双值并合并（{w.combinedValue}）
                          </Button>
                        )}
                        {w.incomingValue && (
                          <Button size="small" onClick={() => handleResolveWarning(w, 'incoming')}>
                            采用「{w.incomingValue}」并合并
                          </Button>
                        )}
                        {w.existingValue && (
                          <Button size="small" onClick={() => handleResolveWarning(w, 'existing')}>
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
                        onClick={() => handleResolveWarning(w, 'swap_time')}
                      >
                        ⚡ 一键对调起止时间
                      </Button>
                    )}
                  </Space>
                </div>
              ))}
            </Space>
          }
        />
      )}

      {list.length === 0 ? (
        <Card>
          <Empty description={filtered ? '没有符合条件的条目' : `还没有${category.label}`}>
            {!filtered && (
              <Space>
                <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing(null)}>
                  手动添加
                </Button>
                <span className="muted">
                  或使用左侧 <RobotOutlined /> AI 整理导入
                </span>
              </Space>
            )}
          </Empty>
        </Card>
      ) : (
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          {list.map((e) => {
            const idx = all.indexOf(e)
            const sub = (category.subtitleFields ?? []).map((k) => formatValue(e.data[k])).filter(Boolean).join(' | ')
            const period = periodText(e.data)
            const hasConflict = conflictEntryIdSet.has(e.id)
            return (
              <Card
                key={e.id}
                size="small"
                hoverable
                style={hasConflict ? { borderColor: '#faad14' } : undefined}
                onClick={() => setEditing(e)}
                title={
                  <Space wrap>
                    <Typography.Text strong style={{ fontSize: 15 }}>
                      {entryTitle(category, e.data)}
                    </Typography.Text>
                    {sub && <span className="muted">{sub}</span>}
                    {hasConflict && (
                      <Tag color="warning" icon={<WarningOutlined />}>
                        存在重复/冲突待核对
                      </Tag>
                    )}
                    {e.source === 'ai' && <Tag color="purple">AI</Tag>}
                    {e.tags.map((t) => (
                      <Tag key={t}>{t}</Tag>
                    ))}
                  </Space>
                }
                extra={
                  <Space size={0} onClick={(ev) => ev.stopPropagation()}>
                    {period && <span className="muted" style={{ marginRight: 8 }}>{period}</span>}
                    {e.attachments.length > 0 && (
                      <Tooltip title={`${e.attachments.length} 个证明文件`}>
                        <Tag icon={<PaperClipOutlined />} color="blue">
                          {e.attachments.length}
                        </Tag>
                      </Tooltip>
                    )}
                    <CopyButton text={entryToParagraph(category, e.data)} />
                    {!filtered && (
                      <>
                        <Button size="small" type="text" icon={<ArrowUpOutlined />} disabled={idx === 0} onClick={() => move(idx, -1)} />
                        <Button size="small" type="text" icon={<ArrowDownOutlined />} disabled={idx === all.length - 1} onClick={() => move(idx, 1)} />
                      </>
                    )}
                    <Button size="small" type="text" icon={<EditOutlined />} onClick={() => setEditing(e)} />
                    <Popconfirm
                      title="删除该条目？"
                      description="其证明文件也会一并删除"
                      onConfirm={async () => {
                        await window.api.deleteEntry(e.id)
                        message.success('已删除')
                        refresh()
                      }}
                    >
                      <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                  </Space>
                }
              >
                {fields
                  .filter((f) => !skip.has(f.key) && formatValue(e.data[f.key]))
                  .map((f) => (
                    <div className="field-row" key={f.key} onClick={(ev) => ev.stopPropagation()}>
                      <span className="field-label">{f.label}</span>
                      <span className="field-value pre-wrap">
                        {f.type === 'tags' ? (
                          (e.data[f.key] as string[]).map((t) => <Tag key={t}>{t}</Tag>)
                        ) : f.sensitive ? (
                          '••••••••'
                        ) : (
                          formatValue(e.data[f.key])
                        )}
                      </span>
                      <CopyButton text={formatValue(e.data[f.key])} />
                    </div>
                  ))}
              </Card>
            )
          })}
        </Space>
      )}

      <EntryEditor open={editing !== undefined} category={category} entry={editing} onClose={() => setEditing(undefined)} />
    </div>
  )
}
