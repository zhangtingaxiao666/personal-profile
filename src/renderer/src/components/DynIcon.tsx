import * as Icons from '@ant-design/icons'
import type { ComponentType } from 'react'

/** 根据图标名称渲染 antd 图标，未知名称时回退为文件夹图标 */
export default function DynIcon({ name }: { name: string }) {
  const C = (Icons as unknown as Record<string, ComponentType>)[name] ?? Icons.FolderOutlined
  return <C />
}

/** 字段管理中可选的分类图标 */
export const ICON_CHOICES = [
  'FolderOutlined',
  'ReadOutlined',
  'BankOutlined',
  'ProjectOutlined',
  'TrophyOutlined',
  'SafetyCertificateOutlined',
  'ToolOutlined',
  'TeamOutlined',
  'FileTextOutlined',
  'HeartOutlined',
  'GlobalOutlined',
  'ExperimentOutlined',
  'StarOutlined',
  'BookOutlined',
  'CameraOutlined',
  'RocketOutlined'
]
