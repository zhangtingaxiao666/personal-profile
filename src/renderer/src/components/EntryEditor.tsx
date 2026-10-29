import { App, Button, Divider, Drawer, Form, Input, Modal, Select, Space, Typography } from 'antd'
import { ThunderboltOutlined } from '@ant-design/icons'
import { useEffect, useState } from 'react'
import type { CategoryDef, Entry, FieldDef } from '@shared/types'
import { visibleFields } from '@shared/categories'
import FieldInput from './FieldInput'
import AttachmentList from './AttachmentList'
import { errMsg, useApp } from '../store'

interface Props {
  open: boolean
  category: CategoryDef
  /** 编辑的条目；为空表示新建 */
  entry?: Entry | null
  onClose: () => void
}

/** 新建 / 编辑条目的抽屉表单（字段由 schema 动态生成，支持多行文本 AI 润色） */
export default function EntryEditor({ open, category, entry, onClose }: Props) {
  const { message } = App.useApp()
  const [form] = Form.useForm()
  const refresh = useApp((s) => s.refresh)
  const db = useApp((s) => s.db)
  const [saving, setSaving] = useState(false)
  /** 新建后保存得到的 id，用于继续添加附件 */
  const [savedId, setSavedId] = useState<string | null>(null)

  /** AI 润色状态 */
  const [polishingField, setPolishingField] = useState<string | null>(null)
  const [polishModal, setPolishModal] = useState<{
    open: boolean
    fieldKey: string
    fieldLabel: string
    original: string
    polished: string
  }>({ open: false, fieldKey: '', fieldLabel: '', original: '', polished: '' })

  const currentId = entry?.id ?? savedId
  const current = db?.entries.find((e) => e.id === currentId)
  const draftKey = `personal_profile_entry_draft_${category.id}_${entry?.id ?? 'new'}`

  useEffect(() => {
    if (open) {
      form.resetFields()
      const baseValues = { ...(entry?.data ?? {}), __tags: entry?.tags ?? [] }
      try {
        const cachedRaw = localStorage.getItem(draftKey)
        if (cachedRaw) {
          const cachedVals = JSON.parse(cachedRaw)
          form.setFieldsValue({ ...baseValues, ...cachedVals })
        } else {
          form.setFieldsValue(baseValues)
        }
      } catch {
        form.setFieldsValue(baseValues)
      }
      setSavedId(null)
    }
  }, [open, entry, form, draftKey])

  const clearDraft = () => {
    try {
      localStorage.removeItem(draftKey)
    } catch {
      // ignore
    }
  }

  const handleClose = () => {
    clearDraft()
    onClose()
  }

  const save = async (close: boolean) => {
    const values = await form.validateFields()
    const { __tags, ...data } = values
    setSaving(true)
    try {
      const saved = await window.api.upsertEntry({ id: currentId ?? undefined, category: category.id, data, tags: __tags ?? [] })
      setSavedId(saved.id)
      clearDraft()
      await refresh()
      message.success('已保存')
      if (close) onClose()
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const handlePolish = async (f: FieldDef) => {
    const rawVal = String(form.getFieldValue(f.key) ?? '').trim()
    if (!rawVal) {
      message.warning(`请先在「${f.label}」中输入草稿要点，再点击 AI 润色`)
      return
    }
    setPolishingField(f.key)
    try {
      const allValues = form.getFieldsValue()
      const { __tags, ...entryContext } = allValues
      const polished = await window.api.polishFieldText({
        categoryLabel: category.label,
        fieldLabel: f.label,
        rawText: rawVal,
        entryContext
      })
      setPolishModal({
        open: true,
        fieldKey: f.key,
        fieldLabel: f.label,
        original: rawVal,
        polished
      })
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setPolishingField(null)
    }
  }

  const allTags = [...new Set((db?.entries ?? []).flatMap((e) => e.tags))]

  return (
    <Drawer
      open={open}
      onClose={handleClose}
      maskClosable={false}
      size={620}
      title={`${currentId ? '编辑' : '新建'}${category.label}`}
      destroyOnHidden
      extra={
        <Space>
          <Button onClick={handleClose}>取消</Button>
          <Button type="primary" loading={saving} onClick={() => save(true)}>
            保存
          </Button>
        </Space>
      }
    >
      <Form
        form={form}
        layout="vertical"
        onValuesChange={(_changed, allValues) => {
          try {
            localStorage.setItem(draftKey, JSON.stringify(allValues))
          } catch {
            // ignore
          }
        }}
      >
        {visibleFields(category).map((f) => (
          <Form.Item
            key={f.key}
            name={f.key}
            label={
              f.type === 'textarea' ? (
                <Space size={8}>
                  <span>{f.label}</span>
                  <Button
                    size="small"
                    type="link"
                    icon={<ThunderboltOutlined />}
                    loading={polishingField === f.key}
                    onClick={() => handlePolish(f)}
                    style={{ padding: 0, height: 'auto', fontSize: 12 }}
                  >
                    ✨ AI 润色
                  </Button>
                </Space>
              ) : (
                f.label
              )
            }
            rules={f.required ? [{ required: true, message: `请填写${f.label}` }] : undefined}
          >
            <FieldInput field={f} />
          </Form.Item>
        ))}
        <Form.Item name="__tags" label="标签" tooltip="用于筛选，例如：竞赛、科研、后端">
          <Select mode="tags" options={allTags.map((t) => ({ label: t, value: t }))} placeholder="输入标签后回车" />
        </Form.Item>
      </Form>
      <Divider titlePlacement="start">证明文件</Divider>
      {current ? (
        <AttachmentList target={{ kind: 'entry', entryId: current.id }} attachments={current.attachments} onChanged={refresh} />
      ) : (
        <Button block type="dashed" onClick={() => save(false)} loading={saving}>
          先保存条目，再添加证明文件
        </Button>
      )}

      <Modal
        open={polishModal.open}
        title={`✨ AI 润色对比 — ${polishModal.fieldLabel}`}
        width={640}
        onCancel={() => setPolishModal((p) => ({ ...p, open: false }))}
        onOk={() => {
          form.setFieldValue(polishModal.fieldKey, polishModal.polished)
          setPolishModal((p) => ({ ...p, open: false }))
          message.success(`已更新「${polishModal.fieldLabel}」`)
        }}
        okText="替换填入"
        cancelText="放弃"
      >
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <div>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              原始草稿：
            </Typography.Text>
            <div
              className="pre-wrap"
              style={{
                marginTop: 4,
                padding: '8px 12px',
                background: '#fafafa',
                border: '1px solid #f0f0f0',
                borderRadius: 6,
                fontSize: 13
              }}
            >
              {polishModal.original}
            </div>
          </div>
          <div>
            <Typography.Text strong style={{ fontSize: 12, color: '#1f4e79' }}>
              AI 润色结果（可继续微调）：
            </Typography.Text>
            <Input.TextArea
              rows={5}
              value={polishModal.polished}
              onChange={(e) => setPolishModal((p) => ({ ...p, polished: e.target.value }))}
              style={{ marginTop: 4 }}
            />
          </div>
        </Space>
      </Modal>
    </Drawer>
  )
}
