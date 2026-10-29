import {
  Alert,
  App,
  Avatar,
  Button,
  Card,
  Col,
  Divider,
  Form,
  Popconfirm,
  Row,
  Space,
  Tag,
  Typography
} from 'antd'
import {
  EditOutlined,
  EyeInvisibleOutlined,
  EyeOutlined,
  SaveOutlined,
  UploadOutlined,
  UserOutlined,
  DeleteOutlined
} from '@ant-design/icons'
import { useEffect, useRef, useState } from 'react'
import { errMsg, useApp } from '../store'
import { visibleFields, formatValue } from '@shared/categories'
import FieldInput from '../components/FieldInput'
import CopyButton from '../components/CopyButton'
import AttachmentList from '../components/AttachmentList'

export default function Profile() {
  const { message } = App.useApp()
  const { db, profileDef, refresh } = useApp()
  const [form] = Form.useForm()

  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [autoSavedHint, setAutoSavedHint] = useState(false)
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [revealed, setRevealed] = useState<Record<string, boolean>>({})
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 加载头像
  useEffect(() => {
    let active = true
    if (db?.profile?.avatarRelPath) {
      window.api.attachmentDataUrl(db.profile.avatarRelPath).then((url) => {
        if (active) setAvatarUrl(url)
      })
    } else {
      setAvatarUrl(null)
    }
    return () => {
      active = false
    }
  }, [db?.profile?.avatarRelPath])

  // 表单初始值同步（编辑中时合并已有输入，避免后台刷新覆盖正在输入的内容）
  useEffect(() => {
    if (db?.profile?.data) {
      if (editing) {
        const currentVals = form.getFieldsValue()
        form.setFieldsValue({ ...db.profile.data, ...currentVals })
      } else {
        form.setFieldsValue(db.profile.data)
      }
    }
  }, [db?.profile?.data, editing, form])

  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    }
  }, [])

  // 编辑时自动防抖落盘，防止切页、修改程序或关闭窗口导致已填数据丢失
  const handleValuesChange = (_changed: Record<string, unknown>, allValues: Record<string, unknown>) => {
    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current)
    autoSaveTimerRef.current = setTimeout(async () => {
      try {
        await window.api.saveProfile(allValues)
        await refresh()
        setAutoSavedHint(true)
      } catch {
        // ignore silent auto-save error
      }
    }, 600)
  }

  const fields = profileDef ? visibleFields(profileDef) : []

  // 更换头像
  const changeAvatar = async () => {
    try {
      const paths = await window.api.pickFiles({ images: true, multi: false })
      if (paths && paths.length > 0) {
        await window.api.setAvatar(paths[0])
        await refresh()
        message.success('已更换照片')
      }
    } catch (e) {
      message.error(errMsg(e))
    }
  }

  // 移除头像
  const removeAvatar = async () => {
    try {
      await window.api.setAvatar(null)
      await refresh()
      message.success('已移除照片')
    } catch (e) {
      message.error(errMsg(e))
    }
  }

  // 保存基本信息
  const save = async () => {
    try {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current)
        autoSaveTimerRef.current = null
      }
      const values = await form.validateFields()
      setSaving(true)
      await window.api.saveProfile(values)
      await refresh()
      message.success('基本信息已保存')
      setAutoSavedHint(false)
      setEditing(false)
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  // 敏感字段打码逻辑：保留前 3 后 4 位，中间 *
  const maskSensitive = (val: string): string => {
    if (!val) return ''
    if (val.length <= 7) return '•'.repeat(val.length)
    return val.slice(0, 3) + '••••••••' + val.slice(-4)
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2>
          <UserOutlined /> 基本信息
        </h2>
        <Space>
          {editing ? (
            <>
              {autoSavedHint && (
                <Tag color="success" style={{ marginInlineEnd: 0 }}>
                  已自动实时保存
                </Tag>
              )}
              <Button
                onClick={() => {
                  if (autoSaveTimerRef.current) {
                    clearTimeout(autoSaveTimerRef.current)
                    autoSaveTimerRef.current = null
                  }
                  setAutoSavedHint(false)
                  setEditing(false)
                }}
              >
                完成返回
              </Button>
              <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={save}>
                保存
              </Button>
            </>
          ) : (
            <Button type="primary" icon={<EditOutlined />} onClick={() => setEditing(true)}>
              编辑信息
            </Button>
          )}
        </Space>
      </div>

      <Alert
        type="info"
        showIcon
        message={
          <span>
            提示：如需新增字段（如“身高”、“英文名”）或调整展示顺序，可前往左侧菜单「<strong>字段管理</strong>」。
          </span>
        }
        style={{ marginBottom: 16 }}
      />

      <Card style={{ marginBottom: 20 }}>
        <Row gutter={[24, 24]}>
          {/* 头像展示与操作 */}
          <Col xs={24} sm={8} md={6} lg={5} style={{ textAlign: 'center' }}>
            <div
              style={{
                width: 104,
                height: 136,
                padding: 4,
                border: '1px solid #d9d9d9',
                borderRadius: 8,
                margin: '0 auto 12px auto',
                background: '#fafafa',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden'
              }}
            >
              {avatarUrl ? (
                <img
                  src={avatarUrl}
                  alt="照片"
                  style={{ width: 96, height: 128, objectFit: 'cover', borderRadius: 4 }}
                />
              ) : (
                <Avatar
                  shape="square"
                  style={{ width: 96, height: 128, borderRadius: 4, background: '#e6f4ff', color: '#1677ff' }}
                  icon={<UserOutlined style={{ fontSize: 44, marginTop: 40 }} />}
                />
              )}
            </div>
            <Space orientation="vertical" size={8} style={{ width: '100%' }}>
              <Button size="small" icon={<UploadOutlined />} onClick={changeAvatar}>
                更换照片
              </Button>
              {db?.profile?.avatarRelPath && (
                <Popconfirm title="确定移除个人照片？" onConfirm={removeAvatar}>
                  <Button size="small" type="text" danger icon={<DeleteOutlined />}>
                    移除照片
                  </Button>
                </Popconfirm>
              )}
            </Space>
          </Col>

          {/* 表单 / 查看模式 */}
          <Col xs={24} sm={16} md={18} lg={19}>
            {editing ? (
              <Form form={form} layout="vertical" onValuesChange={handleValuesChange}>
                <Row gutter={16}>
                  {fields.map((f) => (
                    <Col span={f.type === 'textarea' ? 24 : 12} key={f.key}>
                      <Form.Item
                        name={f.key}
                        label={f.label}
                        rules={f.required ? [{ required: true, message: `请填写${f.label}` }] : undefined}
                      >
                        <FieldInput field={f} />
                      </Form.Item>
                    </Col>
                  ))}
                </Row>
              </Form>
            ) : (
              <div>
                {fields.map((f) => {
                  const rawVal = db?.profile?.data?.[f.key]
                  const textVal = formatValue(rawVal)
                  const isMasked = f.sensitive && !revealed[f.key]

                  return (
                    <div className="field-row" key={f.key}>
                      <span className="field-label">{f.label}</span>
                      <span className="field-value pre-wrap">
                        {textVal ? (
                          f.type === 'tags' && Array.isArray(rawVal) ? (
                            rawVal.map((t) => <Tag key={String(t)}>{String(t)}</Tag>)
                          ) : isMasked ? (
                            maskSensitive(textVal)
                          ) : (
                            textVal
                          )
                        ) : (
                          <span className="muted">未填写</span>
                        )}
                      </span>
                      {f.sensitive && textVal && (
                        <Button
                          size="small"
                          type="text"
                          icon={revealed[f.key] ? <EyeInvisibleOutlined /> : <EyeOutlined />}
                          onClick={() =>
                            setRevealed((prev) => ({
                              ...prev,
                              [f.key]: !prev[f.key]
                            }))
                          }
                          title={revealed[f.key] ? '隐藏明文' : '显示明文'}
                        />
                      )}
                      <CopyButton text={textVal} />
                    </div>
                  )
                })}
              </div>
            )}
          </Col>
        </Row>
      </Card>

      {/* 基本信息证明文件 */}
      <Card title="基本信息证明文件（如身份证扫描件、学生证）">
        <AttachmentList
          target={{ kind: 'profile' }}
          attachments={db?.profile?.attachments ?? []}
          onChanged={refresh}
        />
      </Card>
    </div>
  )
}
