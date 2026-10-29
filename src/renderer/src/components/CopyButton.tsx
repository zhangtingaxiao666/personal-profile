import { Button, Tooltip, App } from 'antd'
import { CopyOutlined, CheckOutlined } from '@ant-design/icons'
import { useState } from 'react'

export async function copyText(text: string): Promise<void> {
  await navigator.clipboard.writeText(text)
}

/** 一键复制按钮 */
export default function CopyButton({ text, label, size = 'small' }: { text: string; label?: string; size?: 'small' | 'middle' }) {
  const { message } = App.useApp()
  const [done, setDone] = useState(false)
  return (
    <Tooltip title={done ? '已复制' : '复制'}>
      <Button
        size={size}
        type="text"
        disabled={!text}
        icon={done ? <CheckOutlined style={{ color: '#52c41a' }} /> : <CopyOutlined />}
        onClick={async (e) => {
          e.stopPropagation()
          await copyText(text)
          message.success({ content: '已复制到剪贴板', duration: 1 })
          setDone(true)
          setTimeout(() => setDone(false), 1200)
        }}
      >
        {label}
      </Button>
    </Tooltip>
  )
}
