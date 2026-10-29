import { Layout, Menu, Spin, Result, Button, Tag } from 'antd'
import {
  DashboardOutlined,
  UserOutlined,
  ThunderboltOutlined,
  RobotOutlined,
  EditOutlined,
  ExportOutlined,
  SettingOutlined,
  AppstoreAddOutlined,
  IdcardOutlined,
  LoadingOutlined
} from '@ant-design/icons'
import { useEffect, useState } from 'react'
import { useApp, useVisibleCategories, errMsg } from './store'
import DynIcon from './components/DynIcon'
import Dashboard from './pages/Dashboard'
import Profile from './pages/Profile'
import CategoryPage from './pages/CategoryPage'
import QuickFill from './pages/QuickFill'
import AiImport from './pages/AiImport'
import Generator from './pages/Generator'
import ExportPage from './pages/Export'
import FieldManager from './pages/FieldManager'
import Settings from './pages/Settings'

/** 页面路由 key：固定页面或 cat:<分类id> */
export type PageKey = string

export default function App() {
  const {
    db,
    miniMode,
    aiImportBusy,
    aiImportPendingCount,
    quickFillBusy,
    quickFillPendingCount,
    refresh,
    refreshSettings
  } = useApp()
  const cats = useVisibleCategories()
  const [page, setPage] = useState<PageKey>('dashboard')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([refresh(), refreshSettings()]).catch((e) => setError(errMsg(e)))
  }, [refresh, refreshSettings])

  if (error)
    return (
      <Result status="error" title="加载数据失败" subTitle={error} extra={<Button onClick={() => location.reload()}>重试</Button>} />
    )
  if (!db) return <Spin fullscreen tip="加载中…" />

  const count = (id: string) => db.entries.filter((e) => e.category === id).length

  const items = [
    { key: 'dashboard', icon: <DashboardOutlined />, label: '总览' },
    {
      key: 'quickfill',
      icon: quickFillBusy ? <LoadingOutlined spin /> : <ThunderboltOutlined />,
      label: (
        <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>快速填表</span>
          {quickFillBusy ? (
            <Tag color="processing" style={{ marginInlineEnd: 0, fontSize: 11 }}>
              后台填表中
            </Tag>
          ) : quickFillPendingCount > 0 ? (
            <Tag color="green" style={{ marginInlineEnd: 0, fontSize: 11 }}>
              待填 {quickFillPendingCount}
            </Tag>
          ) : null}
        </span>
      )
    },
    {
      type: 'group' as const,
      label: '我的资料',
      children: [
        { key: 'profile', icon: <UserOutlined />, label: '基本信息' },
        ...cats.map((c) => ({
          key: 'cat:' + c.id,
          icon: <DynIcon name={c.icon} />,
          label: (
            <span style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{c.label}</span>
              <span className="muted">{count(c.id) || ''}</span>
            </span>
          )
        }))
      ]
    },
    {
      type: 'group' as const,
      label: 'AI 助手',
      children: [
        {
          key: 'ai-import',
          icon: aiImportBusy ? <LoadingOutlined spin /> : <RobotOutlined />,
          label: (
            <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>AI 整理导入</span>
              {aiImportBusy ? (
                <Tag color="processing" style={{ marginInlineEnd: 0, fontSize: 11 }}>
                  后台提取中
                </Tag>
              ) : aiImportPendingCount > 0 ? (
                <Tag color="purple" style={{ marginInlineEnd: 0, fontSize: 11 }}>
                  待审 {aiImportPendingCount}
                </Tag>
              ) : null}
            </span>
          )
        },
        { key: 'generator', icon: <EditOutlined />, label: '文案生成' }
      ]
    },
    {
      type: 'group' as const,
      label: '其他',
      children: [
        { key: 'export', icon: <ExportOutlined />, label: '导出与备份' },
        { key: 'fields', icon: <AppstoreAddOutlined />, label: '字段管理' },
        { key: 'settings', icon: <SettingOutlined />, label: '设置' }
      ]
    }
  ]

  const renderActiveNonPersistent = () => {
    if (page === 'ai-import' || page === 'generator' || page === 'quickfill' || page === 'profile') return null
    if (page.startsWith('cat:')) {
      const c = cats.find((x) => x.id === page.slice(4))
      if (c) return <CategoryPage key={c.id} category={c} />
      return <Dashboard navigate={setPage} />
    }
    switch (page) {
      case 'export':
        return <ExportPage />
      case 'fields':
        return <FieldManager />
      case 'settings':
        return <Settings />
      default:
        return <Dashboard navigate={setPage} />
    }
  }

  return (
    <Layout style={{ height: '100%' }}>
      {!miniMode && (
        <Layout.Sider width={220} theme="light" style={{ borderRight: '1px solid #f0f0f0', overflow: 'auto' }}>
          <div className="sider-logo">
            <IdcardOutlined /> 个人画像
          </div>
          <Menu mode="inline" selectedKeys={[page]} items={items} onClick={(e) => setPage(e.key)} style={{ borderInlineEnd: 'none' }} />
        </Layout.Sider>
      )}
      <Layout.Content style={{ overflow: 'auto' }}>
        {/* 常驻挂载核心交互页面，切换页面时不会中断后台 AI 提取/填表或丢失已填表单内容 */}
        <div style={{ display: page === 'quickfill' ? 'block' : 'none' }}>
          <QuickFill isVisible={page === 'quickfill'} />
        </div>
        <div style={{ display: page === 'profile' ? 'block' : 'none' }}>
          <Profile />
        </div>
        <div style={{ display: page === 'ai-import' ? 'block' : 'none' }}>
          <AiImport navigate={setPage} isVisible={page === 'ai-import'} />
        </div>
        <div style={{ display: page === 'generator' ? 'block' : 'none' }}>
          <Generator />
        </div>
        {renderActiveNonPersistent()}
      </Layout.Content>
    </Layout>
  )
}
