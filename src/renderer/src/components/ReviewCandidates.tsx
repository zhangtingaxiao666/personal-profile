import { Alert, App, Button, Card, Checkbox, Radio, Select, Space, Tag, Typography } from 'antd'
import { PaperClipOutlined, WarningOutlined } from '@ant-design/icons'
import { useState } from 'react'
import type { CommitCandidate, ExtractResult, FieldConflict } from '@shared/types'
import { entryTitle, formatValue, visibleFields } from '@shared/categories'
import { errMsg, useApp, useVisibleCategories } from '../store'
import FieldInput from './FieldInput'

interface Props {
  result: ExtractResult
  onDone: (committedCount: number) => void
  onCancel: () => void
}

interface LocalCandidateItem {
  tempId: string
  selected: boolean
  category: string
  data: Record<string, unknown>
  tags: string[]
  sourceFiles: string[]
  attachSourceFiles: boolean
  duplicateOf?: string
  duplicateAction: 'merge' | 'create'
  conflicts: FieldConflict[]
}

export default function ReviewCandidates({ result, onDone, onCancel }: Props) {
  const { message } = App.useApp()
  const { db } = useApp()
  const cats = useVisibleCategories()
  const profileDef = useApp((s) => s.profileDef)

  const [submitting, setSubmitting] = useState(false)
  const [items, setItems] = useState<LocalCandidateItem[]>(() =>
    result.candidates.map((c) => ({
      tempId: c.tempId,
      selected: true,
      category: c.category,
      data: { ...c.data },
      tags: [...c.tags],
      sourceFiles: [...c.sourceFiles],
      attachSourceFiles: true,
      duplicateOf: c.duplicateOf,
      duplicateAction: 'merge',
      conflicts: c.conflicts ?? []
    }))
  )

  const profilePatchKeys = Object.keys(result.profilePatch ?? {})
  const [selectedProfileKeys, setSelectedProfileKeys] = useState<Set<string>>(
    () => new Set(profilePatchKeys)
  )

  const updateItem = (index: number, patch: Partial<LocalCandidateItem>) => {
    setItems((prev) => {
      const copy = [...prev]
      copy[index] = { ...copy[index], ...patch }
      return copy
    })
  }

  const updateItemField = (index: number, fieldKey: string, val: unknown) => {
    setItems((prev) => {
      const copy = [...prev]
      const nextData = { ...copy[index].data }
      if (val === undefined || val === '') {
        delete nextData[fieldKey]
      } else {
        nextData[fieldKey] = val
      }
      copy[index] = { ...copy[index], data: nextData }
      return copy
    })
  }

  const allSelected = items.length > 0 && items.every((i) => i.selected)
  const selectedCount = items.filter((i) => i.selected).length

  const toggleSelectAll = () => {
    const nextVal = !allSelected
    setItems((prev) => prev.map((i) => ({ ...i, selected: nextVal })))
  }

  const getDupTitle = (id: string) => {
    const entry = db?.entries.find((e) => e.id === id)
    if (!entry) return id
    const cat = cats.find((c) => c.id === entry.category)
    return entryTitle(cat, entry.data)
  }

  const handleCommit = async () => {
    const selectedCandidates = items.filter((i) => i.selected)
    setSubmitting(true)
    try {
      const patchToCommit: Record<string, unknown> = {}
      for (const k of selectedProfileKeys) {
        if (result.profilePatch && k in result.profilePatch) {
          patchToCommit[k] = result.profilePatch[k]
        }
      }

      const toCommit: CommitCandidate[] = selectedCandidates.map((c) => ({
        category: c.category,
        data: c.data,
        tags: c.tags,
        sourceFiles: c.attachSourceFiles ? c.sourceFiles : [],
        mergeInto: c.duplicateOf && c.duplicateAction === 'merge' ? c.duplicateOf : undefined
      }))

      const entries = await window.api.commitCandidates(
        toCommit,
        Object.keys(patchToCommit).length > 0 ? patchToCommit : undefined
      )
      message.success(`成功入库 ${entries.length} 条资料${Object.keys(patchToCommit).length > 0 ? '，已补充基本信息' : ''}`)
      onDone(entries.length)
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {result.warnings && result.warnings.length > 0 && (
        <Alert
          type="warning"
          showIcon
          title="识别与冲突提示"
          description={
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          }
        />
      )}

      <Alert
        type="info"
        showIcon
        title="AI 生成内容可能有误，请逐条核对后再入库（若检测到重复或成绩冲突，可一键选择处理策略）"
      />

      {profilePatchKeys.length > 0 && (
        <Card
          size="small"
          title={
            <Space>
              <span>建议补充到基本信息</span>
              <span className="muted" style={{ fontSize: 13, fontWeight: 400 }}>
                （只会填充当前为空的字段）
              </span>
            </Space>
          }
        >
          <Space direction="vertical" style={{ width: '100%' }}>
            {profilePatchKeys.map((key) => {
              const f = profileDef?.fields.find((field) => field.key === key)
              const label = f?.label ?? key
              const val = formatValue(result.profilePatch[key])
              return (
                <Checkbox
                  key={key}
                  checked={selectedProfileKeys.has(key)}
                  onChange={(e) => {
                    setSelectedProfileKeys((prev) => {
                      const next = new Set(prev)
                      if (e.target.checked) next.add(key)
                      else next.delete(key)
                      return next
                    })
                  }}
                >
                  <span style={{ fontWeight: 500 }}>{label}</span>：{val}
                </Checkbox>
              )
            })}
          </Space>
        </Card>
      )}

      <Space direction="vertical" style={{ width: '100%' }} size={16}>
        {items.map((item, idx) => {
          const catDef = cats.find((c) => c.id === item.category)
          const fields = catDef ? visibleFields(catDef) : []
          const hasConflicts = item.conflicts.length > 0

          return (
            <Card
              key={item.tempId}
              size="small"
              style={{
                borderColor: hasConflicts ? '#fa8c16' : item.selected ? '#1f4e79' : '#e0e0e0',
                boxShadow: item.selected ? '0 1px 4px rgba(31, 78, 121, 0.12)' : 'none'
              }}
              title={
                <Space wrap align="center">
                  <Checkbox
                    checked={item.selected}
                    onChange={(e) => updateItem(idx, { selected: e.target.checked })}
                  >
                    入库
                  </Checkbox>
                  <Select
                    value={item.category}
                    onChange={(c) => updateItem(idx, { category: c })}
                    style={{ width: 140 }}
                    options={cats.map((c) => ({ label: c.label, value: c.id }))}
                  />
                  {item.duplicateOf && (
                    <Tag color={hasConflicts ? 'volcano' : 'orange'} icon={<WarningOutlined />}>
                      {hasConflicts
                        ? `检测到冲突条目：${getDupTitle(item.duplicateOf)}`
                        : `疑似与已有条目重复：${getDupTitle(item.duplicateOf)}`}
                    </Tag>
                  )}
                  {item.sourceFiles.map((sf) => {
                    const fn = sf.replace(/\\/g, '/').split('/').pop() || sf
                    return (
                      <Tag key={sf} icon={<PaperClipOutlined />}>
                        {fn}
                      </Tag>
                    )
                  })}
                </Space>
              }
              extra={
                item.duplicateOf ? (
                  <Radio.Group
                    size="small"
                    value={item.duplicateAction}
                    onChange={(e) => updateItem(idx, { duplicateAction: e.target.value })}
                  >
                    <Radio.Button value="merge">合并到已有条目</Radio.Button>
                    <Radio.Button value="create">作为独立新条目</Radio.Button>
                  </Radio.Group>
                ) : null
              }
            >
              <Space direction="vertical" style={{ width: '100%' }} size={12}>
                {hasConflicts && (
                  <Alert
                    type="warning"
                    showIcon
                    title={`与已有记录「${item.duplicateOf ? getDupTitle(item.duplicateOf) : ''}」存在 ${item.conflicts.length} 处字段冲突`}
                    description={
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 6 }}>
                        {item.conflicts.map((conf) => (
                          <div
                            key={conf.fieldKey}
                            style={{
                              padding: '8px 12px',
                              background: '#fff',
                              border: '1px solid #ffd591',
                              borderRadius: 6
                            }}
                          >
                            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                              <div>
                                <Typography.Text strong>【{conf.fieldLabel}】</Typography.Text>
                                <span style={{ marginLeft: 8 }}>
                                  已有值：<Tag>{conf.existingValue}</Tag> vs 新提取值：
                                  <Tag color="blue">{conf.incomingValue}</Tag>
                                  当前将保存为：
                                  <Tag color="green">{formatValue(item.data[conf.fieldKey]) || '（空）'}</Tag>
                                </span>
                              </div>
                              <Space size={6} wrap>
                                <Button
                                  size="small"
                                  onClick={() => {
                                    updateItemField(idx, conf.fieldKey, conf.incomingValue)
                                    message.info(`「${conf.fieldLabel}」已设为新提取值`)
                                  }}
                                >
                                  采用新值
                                </Button>
                                <Button
                                  size="small"
                                  onClick={() => {
                                    updateItemField(idx, conf.fieldKey, conf.existingValue)
                                    message.info(`「${conf.fieldLabel}」已保留原值`)
                                  }}
                                >
                                  保留已有值
                                </Button>
                                {conf.combinedValue && (
                                  <Button
                                    size="small"
                                    type="primary"
                                    ghost
                                    onClick={() => {
                                      updateItemField(idx, conf.fieldKey, conf.combinedValue)
                                      message.success(`「${conf.fieldLabel}」已采用双值并存标注`)
                                    }}
                                  >
                                    双值并存标注
                                  </Button>
                                )}
                                <Button
                                  size="small"
                                  onClick={() => {
                                    updateItem(idx, { duplicateAction: 'create' })
                                    message.info('已切换为「作为独立新条目」（适用于不同学期/阶段记录）')
                                  }}
                                >
                                  作为不同阶段新条目
                                </Button>
                              </Space>
                            </div>
                            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                              💡 {conf.hint}
                            </div>
                          </div>
                        ))}
                      </div>
                    }
                  />
                )}

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                    gap: '12px 16px'
                  }}
                >
                  {fields.map((f) => (
                    <div key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span style={{ fontSize: 13, color: '#595959' }}>
                        {f.required && <span style={{ color: '#ff4d4f', marginRight: 4 }}>*</span>}
                        {f.label}
                      </span>
                      <FieldInput
                        field={f}
                        value={item.data[f.key]}
                        onChange={(v) => updateItemField(idx, f.key, v)}
                      />
                    </div>
                  ))}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ fontSize: 13, color: '#595959' }}>标签</span>
                  <Select
                    mode="tags"
                    value={item.tags}
                    onChange={(t) => updateItem(idx, { tags: t })}
                    placeholder="输入标签后回车"
                    tokenSeparators={[',', '，', '、', ';', '；']}
                    style={{ width: '100%' }}
                  />
                </div>

                {item.sourceFiles.length > 0 && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      background: '#fafafa',
                      borderRadius: 6
                    }}
                  >
                    <Checkbox
                      checked={item.attachSourceFiles}
                      onChange={(e) => updateItem(idx, { attachSourceFiles: e.target.checked })}
                    >
                      附加源文件为证明文件
                    </Checkbox>
                    <span className="muted" style={{ fontSize: 12 }}>
                      确认后源文件将自动作为证明文件附加
                    </span>
                  </div>
                )}
              </Space>
            </Card>
          )
        })}
      </Space>

      <div
        style={{
          position: 'sticky',
          bottom: 0,
          background: '#fff',
          padding: '12px 24px',
          borderTop: '1px solid #f0f0f0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          boxShadow: '0 -2px 8px rgba(0,0,0,0.06)',
          zIndex: 10
        }}
      >
        <Space>
          <Button onClick={toggleSelectAll}>{allSelected ? '全不选' : '全选'}</Button>
          <span className="muted">
            已选 {selectedCount} / {items.length} 条候选
          </span>
        </Space>
        <Space>
          <Button onClick={onCancel}>放弃</Button>
          <Button
            type="primary"
            loading={submitting}
            disabled={selectedCount === 0 && selectedProfileKeys.size === 0}
            onClick={handleCommit}
          >
            确认入库（{selectedCount} 条）
          </Button>
        </Space>
      </div>
    </div>
  )
}
