import { AutoComplete, DatePicker, Input, InputNumber, Select } from 'antd'
import dayjs from 'dayjs'
import type { FieldDef } from '@shared/types'

interface Props {
  field: FieldDef
  value?: unknown
  onChange?: (v: unknown) => void
}

/** 根据字段定义渲染输入控件（受控，兼容 antd Form.Item） */
export default function FieldInput({ field, value, onChange }: Props) {
  const ph = field.placeholder ?? `请输入${field.label}`
  switch (field.type) {
    case 'textarea':
      return <Input.TextArea value={value as string} onChange={(e) => onChange?.(e.target.value)} placeholder={ph} autoSize={{ minRows: 3, maxRows: 12 }} />
    case 'select':
      return (
        // AutoComplete：既可选预设项，也可输入自定义值
        <AutoComplete
          value={(value as string) || undefined}
          onChange={(v) => onChange?.(v)}
          placeholder={`请选择或输入${field.label}`}
          allowClear
          options={(field.options ?? []).map((o) => ({ label: o, value: o }))}
          filterOption={false}
        />
      )
    case 'tags':
      return (
        <Select
          mode="tags"
          value={(value as string[]) ?? []}
          onChange={(v) => onChange?.(v)}
          tokenSeparators={[',', '，', '、', ';', '；']}
          placeholder={`输入${field.label}后回车`}
          open={false}
          suffixIcon={null}
        />
      )
    case 'month': {
      const v = typeof value === 'string' && /^\d{4}-\d{2}$/.test(value) ? dayjs(value + '-01') : null
      const isNow = value === '至今'
      return (
        <div style={{ display: 'flex', gap: 8 }}>
          <DatePicker
            picker="month"
            value={v}
            style={{ flex: 1 }}
            format="YYYY-MM"
            placeholder={isNow ? '至今' : '选择月份'}
            onChange={(d) => onChange?.(d ? d.format('YYYY-MM') : undefined)}
          />
          {(field.key === 'end' || field.key === 'expire') && (
            <a onClick={() => onChange?.(isNow ? undefined : '至今')} style={{ lineHeight: '32px', whiteSpace: 'nowrap' }}>
              {isNow ? '取消至今' : field.key === 'end' ? '至今' : '长期'}
            </a>
          )}
        </div>
      )
    }
    case 'date': {
      const v = typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? dayjs(value) : null
      return <DatePicker value={v} style={{ width: '100%' }} format="YYYY-MM-DD" onChange={(d) => onChange?.(d ? d.format('YYYY-MM-DD') : undefined)} />
    }
    case 'number':
      return <InputNumber value={value as number} onChange={(v) => onChange?.(v)} style={{ width: '100%' }} />
    case 'url':
    case 'text':
    default:
      return field.sensitive ? (
        <Input.Password value={value as string} onChange={(e) => onChange?.(e.target.value)} placeholder={ph} visibilityToggle />
      ) : (
        <Input value={value as string} onChange={(e) => onChange?.(e.target.value)} placeholder={ph} />
      )
  }
}
