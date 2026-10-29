import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Col,
  Form,
  Input,
  List,
  Modal,
  Popconfirm,
  Row,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography
} from 'antd'
import {
  AppstoreAddOutlined,
  ArrowDownOutlined,
  ArrowUpOutlined,
  DeleteOutlined,
  PlusOutlined,
  UserOutlined
} from '@ant-design/icons'
import { useState } from 'react'
import type { CategoryDef, FieldDef, FieldType, SchemaOverrides } from '@shared/types'
import { emptyOverrides, makeFieldKey } from '@shared/categories'
import { errMsg, useApp } from '../store'
import DynIcon, { ICON_CHOICES } from '../components/DynIcon'

const FIELD_TYPE_OPTIONS: { label: string; value: FieldType }[] = [
  { label: '单行文本 (text)', value: 'text' },
  { label: '多行文本 (textarea)', value: 'textarea' },
  { label: '日期 (date)', value: 'date' },
  { label: '年月 (month)', value: 'month' },
  { label: '下拉选项 (select)', value: 'select' },
  { label: '标签 (tags)', value: 'tags' },
  { label: '链接 (url)', value: 'url' },
  { label: '数字 (number)', value: 'number' }
]

const FIELD_TYPE_NAMES: Record<FieldType, string> = {
  text: '单行文本',
  textarea: '多行文本',
  date: '日期',
  month: '年月',
  select: '下拉选项',
  tags: '标签',
  url: '链接',
  number: '数字'
}

export default function FieldManager() {
  const { message } = App.useApp()
  const { db, categories, profileDef, refresh } = useApp()

  const [selectedId, setSelectedId] = useState<string>('profile')
  const [addFieldModalOpen, setAddFieldModalOpen] = useState(false)
  const [newCatModalOpen, setNewCatModalOpen] = useState(false)

  const [addFieldForm] = Form.useForm()
  const [newCatForm] = Form.useForm()
  const [saving, setSaving] = useState(false)

  // 获得当前选中的分类定义
  const activeCat: CategoryDef | undefined =
    selectedId === 'profile' ? (profileDef ?? undefined) : categories.find((c) => c.id === selectedId)

  // 更新 schema 的辅助方法
  const saveNewSchema = async (mutator: (s: SchemaOverrides) => void) => {
    const next: SchemaOverrides = structuredClone(db?.schema ?? emptyOverrides())
    next.categories = next.categories ?? {}
    next.customCategories = next.customCategories ?? []
    mutator(next)
    setSaving(true)
    try {
      await window.api.saveSchema(next)
      await refresh()
      message.success('已保存修改')
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  // 获取或初始化分类覆盖配置
  const getOrCreateCatOverride = (s: SchemaOverrides, catId: string) => {
    let cat = s.categories[catId]
    if (!cat) {
      cat = {}
      s.categories[catId] = cat
    }
    return cat
  }

  // 分类排序
  const moveCategory = async (idx: number, dir: -1 | 1) => {
    const list = categories.map((c) => c.id)
    const targetIdx = idx + dir
    if (targetIdx < 0 || targetIdx >= list.length) return
    ;[list[idx], list[targetIdx]] = [list[targetIdx], list[idx]]
    await saveNewSchema((s) => {
      s.categoryOrder = list
    })
  }

  // 分类名称修改
  const handleCategoryLabelChange = async (newLabel: string) => {
    if (!activeCat) return
    const trimmed = newLabel.trim()
    if (!trimmed || trimmed === activeCat.label) return
    await saveNewSchema((s) => {
      const c = s.customCategories.find((x) => x.id === activeCat.id)
      if (c) c.label = trimmed
      const cat = getOrCreateCatOverride(s, activeCat.id)
      cat.label = trimmed
    })
  }

  // 分类隐藏/显示
  const handleCategoryHiddenChange = async (hidden: boolean) => {
    if (!activeCat || activeCat.id === 'profile') return
    await saveNewSchema((s) => {
      const c = s.customCategories.find((x) => x.id === activeCat.id)
      if (c) c.hidden = hidden
      const cat = getOrCreateCatOverride(s, activeCat.id)
      cat.hidden = hidden
    })
  }

  // 删除自定义分类
  const handleDeleteCategory = async () => {
    if (!activeCat || !activeCat.custom) return
    const catId = activeCat.id
    await saveNewSchema((s) => {
      s.customCategories = s.customCategories.filter((c) => c.id !== catId)
      delete s.categories[catId]
      if (s.categoryOrder) {
        s.categoryOrder = s.categoryOrder.filter((id) => id !== catId)
      }
    })
    setSelectedId('profile')
  }

  // 字段名修改
  const handleFieldLabelChange = async (fieldKey: string, newLabel: string) => {
    if (!activeCat) return
    const trimmed = newLabel.trim()
    if (!trimmed) return
    await saveNewSchema((s) => {
      const cat = getOrCreateCatOverride(s, activeCat.id)
      if (!cat.fieldPatches) {
        cat.fieldPatches = {}
      }
      cat.fieldPatches[fieldKey] = {
        ...cat.fieldPatches[fieldKey],
        label: trimmed
      }
      const c = s.customCategories.find((x) => x.id === activeCat.id)
      if (c) {
        const f = c.fields.find((x) => x.key === fieldKey)
        if (f) f.label = trimmed
      }
    })
  }

  // 字段显示/隐藏
  const handleFieldHiddenChange = async (fieldKey: string, hidden: boolean) => {
    if (!activeCat) return
    await saveNewSchema((s) => {
      const cat = getOrCreateCatOverride(s, activeCat.id)
      if (!cat.fieldPatches) {
        cat.fieldPatches = {}
      }
      cat.fieldPatches[fieldKey] = {
        ...cat.fieldPatches[fieldKey],
        hidden
      }
    })
  }

  // 自定义字段类型修改
  const handleFieldTypeChange = async (fieldKey: string, newType: FieldType) => {
    if (!activeCat) return
    await saveNewSchema((s) => {
      const c = s.customCategories.find((x) => x.id === activeCat.id)
      if (c) {
        const f = c.fields.find((x) => x.key === fieldKey)
        if (f) f.type = newType
      } else {
        const cat = s.categories[activeCat.id]
        const ef = cat?.extraFields?.find((x) => x.key === fieldKey)
        if (ef) ef.type = newType
      }
    })
  }

  // 字段移动
  const handleMoveField = async (idx: number, dir: -1 | 1) => {
    if (!activeCat) return
    const keys = activeCat.fields.map((f) => f.key)
    const targetIdx = idx + dir
    if (targetIdx < 0 || targetIdx >= keys.length) return
    ;[keys[idx], keys[targetIdx]] = [keys[targetIdx], keys[idx]]
    await saveNewSchema((s) => {
      const cat = getOrCreateCatOverride(s, activeCat.id)
      cat.fieldOrder = keys
    })
  }

  // 删除自定义字段
  const handleDeleteCustomField = async (fieldKey: string) => {
    if (!activeCat) return
    await saveNewSchema((s) => {
      const c = s.customCategories.find((x) => x.id === activeCat.id)
      if (c) {
        c.fields = c.fields.filter((x) => x.key !== fieldKey)
      }
      const cat = s.categories[activeCat.id]
      if (cat?.extraFields) {
        cat.extraFields = cat.extraFields.filter((x) => x.key !== fieldKey)
      }
      if (cat?.fieldPatches) {
        delete cat.fieldPatches[fieldKey]
      }
      if (cat?.fieldOrder) {
        cat.fieldOrder = cat.fieldOrder.filter((k) => k !== fieldKey)
      }
    })
  }

  // 提交添加字段
  const submitAddField = async () => {
    if (!activeCat) return
    try {
      const values = await addFieldForm.validateFields()
      const newKey = makeFieldKey()
      const newField: FieldDef = {
        key: newKey,
        label: values.label.trim(),
        type: values.type,
        options: values.type === 'select' ? values.options : undefined,
        sensitive: values.sensitive ?? false,
        custom: true
      }

      await saveNewSchema((s) => {
        const isCustomCat = s.customCategories.some((c) => c.id === activeCat.id)
        if (isCustomCat) {
          const c = s.customCategories.find((x) => x.id === activeCat.id)
          if (c) c.fields.push(newField)
        } else {
          const cat = getOrCreateCatOverride(s, activeCat.id)
          if (!cat.extraFields) {
            cat.extraFields = []
          }
          cat.extraFields.push(newField)
        }
        const cat = s.categories[activeCat.id]
        if (cat?.fieldOrder) {
          cat.fieldOrder.push(newKey)
        }
      })

      addFieldForm.resetFields()
      setAddFieldModalOpen(false)
    } catch (e) {
      if (e && typeof e === 'object' && 'errorFields' in e) return
      message.error(errMsg(e))
    }
  }

  // 提交新建分类
  const submitNewCategory = async () => {
    try {
      const values = await newCatForm.validateFields()
      const newCatId = 'cc_' + Math.random().toString(36).slice(2, 8)
      const newCat: CategoryDef = {
        id: newCatId,
        label: values.label.trim(),
        icon: values.icon || 'FolderOutlined',
        titleField: 'name',
        aiHint: values.aiHint?.trim() || undefined,
        custom: true,
        fields: [
          { key: 'name', label: '名称', type: 'text', required: true },
          { key: 'start', label: '开始时间', type: 'month' },
          { key: 'end', label: '结束时间', type: 'month' },
          { key: 'description', label: '描述', type: 'textarea' }
        ]
      }

      await saveNewSchema((s) => {
        s.customCategories.push(newCat)
        if (s.categoryOrder) {
          s.categoryOrder.push(newCatId)
        }
      })

      newCatForm.resetFields()
      setNewCatModalOpen(false)
      setSelectedId(newCatId)
    } catch (e) {
      if (e && typeof e === 'object' && 'errorFields' in e) return
      message.error(errMsg(e))
    }
  }

  const selectedFieldType = Form.useWatch('type', addFieldForm)

  return (
    <div className="page">
      <div className="page-header">
        <h2>
          <AppstoreAddOutlined /> 字段管理
        </h2>
      </div>

      <Alert
        type="info"
        showIcon
        message="字段配置与数据说明"
        description="修改字段名称或隐藏字段不会删除已录入的数据；删除自定义分类或字段后，已录入的值仍保留在本地数据文件中。"
        style={{ marginBottom: 16 }}
      />

      <Row gutter={16}>
        {/* 左侧分类列表 */}
        <Col xs={24} md={8} lg={7}>
          <Card
            title="资料分类"
            size="small"
            extra={
              <Button
                type="primary"
                size="small"
                icon={<PlusOutlined />}
                onClick={() => {
                  newCatForm.resetFields()
                  newCatForm.setFieldsValue({ icon: 'FolderOutlined' })
                  setNewCatModalOpen(true)
                }}
              >
                新建分类
              </Button>
            }
          >
            {/* 基本信息单独置顶 */}
            <div
              onClick={() => setSelectedId('profile')}
              style={{
                padding: '10px 12px',
                borderRadius: 6,
                background: selectedId === 'profile' ? '#e6f4ff' : '#ffffff',
                border: selectedId === 'profile' ? '1px solid #91caff' : '1px solid #f0f0f0',
                cursor: 'pointer',
                marginBottom: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                transition: 'all 0.2s'
              }}
            >
              <Space>
                <UserOutlined style={{ color: '#1f4e79', fontSize: 16 }} />
                <Typography.Text strong={selectedId === 'profile'}>基本信息</Typography.Text>
              </Space>
              <Tag color="cyan">内置</Tag>
            </div>

            {/* 其余分类列表（支持上移/下移排序） */}
            <List
              size="small"
              dataSource={categories}
              renderItem={(c, idx) => {
                const isSelected = selectedId === c.id
                return (
                  <List.Item
                    onClick={() => setSelectedId(c.id)}
                    style={{
                      padding: '8px 10px',
                      borderRadius: 6,
                      background: isSelected ? '#e6f4ff' : '#ffffff',
                      border: isSelected ? '1px solid #91caff' : '1px solid #f0f0f0',
                      cursor: 'pointer',
                      marginBottom: 6,
                      transition: 'all 0.2s'
                    }}
                    actions={[
                      <Button
                        key="up"
                        size="small"
                        type="text"
                        icon={<ArrowUpOutlined />}
                        disabled={idx === 0 || saving}
                        onClick={(e) => {
                          e.stopPropagation()
                          moveCategory(idx, -1)
                        }}
                      />,
                      <Button
                        key="down"
                        size="small"
                        type="text"
                        icon={<ArrowDownOutlined />}
                        disabled={idx === categories.length - 1 || saving}
                        onClick={(e) => {
                          e.stopPropagation()
                          moveCategory(idx, 1)
                        }}
                      />
                    ]}
                  >
                    <Space style={{ opacity: c.hidden ? 0.5 : 1 }}>
                      <span style={{ color: '#1f4e79' }}>
                        <DynIcon name={c.icon} />
                      </span>
                      <Typography.Text strong={isSelected} delete={c.hidden}>
                        {c.label}
                      </Typography.Text>
                      {c.custom && <Tag color="blue">自定义</Tag>}
                      {c.hidden && <Tag>已隐藏</Tag>}
                    </Space>
                  </List.Item>
                )
              }}
            />
          </Card>
        </Col>

        {/* 右侧编辑面板 */}
        <Col xs={24} md={16} lg={17}>
          {activeCat ? (
            <Card
              size="small"
              title={
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 0' }}>
                  <Space align="center" wrap>
                    <span style={{ fontSize: 18, color: '#1f4e79' }}>
                      <DynIcon name={activeCat.icon} />
                    </span>
                    <Input
                      key={`${activeCat.id}_${activeCat.label}`}
                      defaultValue={activeCat.label}
                      disabled={activeCat.id === 'profile'}
                      onBlur={(e) => handleCategoryLabelChange(e.target.value)}
                      onPressEnter={(e) => (e.target as HTMLInputElement).blur()}
                      style={{ width: 160, fontWeight: 600 }}
                      placeholder="分类名称"
                    />
                    {activeCat.id !== 'profile' && (
                      <Space size={4}>
                        <span className="muted" style={{ fontSize: 13 }}>
                          显示分类:
                        </span>
                        <Switch
                          checked={!activeCat.hidden}
                          onChange={(v) => handleCategoryHiddenChange(!v)}
                        />
                      </Space>
                    )}
                    {activeCat.custom && (
                      <Popconfirm
                        title="删除该自定义分类？"
                        description="该分类下的所有录入条目仍会保留在数据文件中，但不再展示。"
                        onConfirm={handleDeleteCategory}
                      >
                        <Button size="small" type="text" danger icon={<DeleteOutlined />}>
                          删除分类
                        </Button>
                      </Popconfirm>
                    )}
                  </Space>
                  <Button
                    type="primary"
                    size="small"
                    icon={<PlusOutlined />}
                    onClick={() => {
                      addFieldForm.resetFields()
                      addFieldForm.setFieldsValue({ type: 'text' })
                      setAddFieldModalOpen(true)
                    }}
                  >
                    添加字段
                  </Button>
                </div>
              }
            >
              <Table
                size="small"
                pagination={false}
                rowKey="key"
                dataSource={activeCat.fields}
                columns={[
                  {
                    title: '排序',
                    width: 76,
                    render: (_, __, idx) => (
                      <Space size={0}>
                        <Button
                          size="small"
                          type="text"
                          icon={<ArrowUpOutlined />}
                          disabled={idx === 0 || saving}
                          onClick={() => handleMoveField(idx, -1)}
                        />
                        <Button
                          size="small"
                          type="text"
                          icon={<ArrowDownOutlined />}
                          disabled={idx === activeCat.fields.length - 1 || saving}
                          onClick={() => handleMoveField(idx, 1)}
                        />
                      </Space>
                    )
                  },
                  {
                    title: '字段名',
                    dataIndex: 'label',
                    width: 170,
                    render: (_, record) => (
                      <Input
                        key={`${activeCat.id}_${record.key}_${record.label}`}
                        defaultValue={record.label}
                        size="small"
                        onBlur={(e) => handleFieldLabelChange(record.key, e.target.value)}
                        onPressEnter={(e) => (e.target as HTMLInputElement).blur()}
                      />
                    )
                  },
                  {
                    title: 'Key',
                    dataIndex: 'key',
                    width: 110,
                    render: (k: string) => (
                      <span className="muted" style={{ fontSize: 12, fontFamily: 'monospace' }}>
                        {k}
                      </span>
                    )
                  },
                  {
                    title: '类型',
                    dataIndex: 'type',
                    width: 140,
                    render: (t: FieldType, record) => {
                      if (record.custom) {
                        return (
                          <Select
                            size="small"
                            value={t}
                            style={{ width: 120 }}
                            onChange={(val) => handleFieldTypeChange(record.key, val)}
                            options={FIELD_TYPE_OPTIONS}
                          />
                        )
                      }
                      return <Tag>{FIELD_TYPE_NAMES[t] ?? t}</Tag>
                    }
                  },
                  {
                    title: '属性',
                    width: 100,
                    render: (_, record) => (
                      <Space size={4}>
                        {record.required && <Tag color="red">必填</Tag>}
                        {record.sensitive && <Tag color="gold">敏感</Tag>}
                        {record.custom && <Tag color="blue">自定义</Tag>}
                      </Space>
                    )
                  },
                  {
                    title: '显示',
                    width: 70,
                    render: (_, record) => {
                      const isTitleField = record.key === activeCat.titleField
                      return (
                        <Tooltip title={isTitleField ? '主标题字段不可隐藏' : undefined}>
                          <Switch
                            size="small"
                            checked={!record.hidden}
                            disabled={isTitleField || saving}
                            onChange={(visible) => handleFieldHiddenChange(record.key, !visible)}
                          />
                        </Tooltip>
                      )
                    }
                  },
                  {
                    title: '操作',
                    width: 60,
                    render: (_, record) => {
                      if (!record.custom) return <span className="muted">-</span>
                      return (
                        <Popconfirm
                          title="确定删除该自定义字段？"
                          description="已录入的数据仍会保存在数据文件中。"
                          onConfirm={() => handleDeleteCustomField(record.key)}
                        >
                          <Button size="small" type="text" danger icon={<DeleteOutlined />} />
                        </Popconfirm>
                      )
                    }
                  }
                ]}
              />
            </Card>
          ) : (
            <Card>
              <Typography.Text type="secondary">请选择左侧分类进行管理</Typography.Text>
            </Card>
          )}
        </Col>
      </Row>

      {/* 添加字段 Modal */}
      <Modal
        open={addFieldModalOpen}
        title={`在「${activeCat?.label}」中添加字段`}
        destroyOnHidden
        onCancel={() => setAddFieldModalOpen(false)}
        onOk={submitAddField}
      >
        <Form form={addFieldForm} layout="vertical" initialValues={{ type: 'text', sensitive: false }}>
          <Form.Item
            name="label"
            label="字段名称"
            rules={[{ required: true, message: '请输入字段名称' }]}
          >
            <Input placeholder="如：导师姓名、项目预算、个人主页" />
          </Form.Item>

          <Form.Item name="type" label="字段类型" rules={[{ required: true, message: '请选择类型' }]}>
            <Select options={FIELD_TYPE_OPTIONS} />
          </Form.Item>

          {selectedFieldType === 'select' && (
            <Form.Item name="options" label="下拉预设选项" tooltip="输入单个选项后回车确认">
              <Select mode="tags" placeholder="输入选项后按回车添加" />
            </Form.Item>
          )}

          <Form.Item name="sensitive" valuePropName="checked">
            <Checkbox>设为敏感字段（界面默认打码，且不向 AI 传输）</Checkbox>
          </Form.Item>
        </Form>
      </Modal>

      {/* 新建分类 Modal */}
      <Modal
        open={newCatModalOpen}
        title="新建自定义资料分类"
        destroyOnHidden
        onCancel={() => setNewCatModalOpen(false)}
        onOk={submitNewCategory}
      >
        <Form
          form={newCatForm}
          layout="vertical"
          initialValues={{ icon: 'FolderOutlined' }}
        >
          <Form.Item
            name="label"
            label="分类名称"
            rules={[{ required: true, message: '请输入分类名称' }]}
          >
            <Input placeholder="如：学术讲座、志愿活动、发明专利" />
          </Form.Item>

          <Form.Item name="icon" label="分类图标" rules={[{ required: true }]}>
            <Select
              options={ICON_CHOICES.map((ic) => ({
                value: ic,
                label: (
                  <Space>
                    <DynIcon name={ic} />
                    <span>{ic}</span>
                  </Space>
                )
              }))}
            />
          </Form.Item>

          <Form.Item
            name="aiHint"
            label="分类说明（给 AI 助手的提示）"
            tooltip="可选，用于在 AI 整理导入时帮助识别归类"
          >
            <Input.TextArea
              rows={2}
              placeholder="例如：参与的学术会议、讲座经历以及所作报告"
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
