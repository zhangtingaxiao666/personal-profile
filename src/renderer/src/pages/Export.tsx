import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Col,
  Divider,
  Empty,
  Input,
  List,
   Modal,
  Popconfirm,
  Radio,
  Row,
  Space,
  Spin,
  Switch,
  Tag,
  Tooltip,
  Typography
} from 'antd'
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  ClearOutlined,
  CloudDownloadOutlined,
  CloudUploadOutlined,
  ExportOutlined,
  FilePdfOutlined,
  FileWordOutlined,
  FileZipOutlined,
  HistoryOutlined,
  PlusCircleOutlined,
  RollbackOutlined
} from '@ant-design/icons'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  DeAiPatchItem,
  ExportProofsOptions,
  ExportResumeOptions,
  ResumeDensity,
  ResumeTheme,
  SnapshotMeta
} from '@shared/types'
import { entryTitle } from '@shared/categories'
import { errMsg, useApp, useVisibleCategories } from '../store'

export default function ExportPage() {
  const { message } = App.useApp()
  const { db, refresh } = useApp()
  const cats = useVisibleCategories()

  // ---- 简历导出选项 ----
  const [title, setTitle] = useState('')
  const [includePhoto, setIncludePhoto] = useState(true)
  const [theme, setTheme] = useState<ResumeTheme>('classic')
  const [density, setDensity] = useState<ResumeDensity>('normal')

  // ---- 简历去 AI 味状态 ----
  const [deAiLoading, setDeAiLoading] = useState(false)
  const [deAiModalOpen, setDeAiModalOpen] = useState(false)
  const [deAiPatches, setDeAiPatches] = useState<DeAiPatchItem[]>([])
  const [applyingDeAi, setApplyingDeAi] = useState(false)

  // 有条目的分类
  const availableCats = useMemo(
    () => cats.filter((c) => (db?.entries ?? []).some((e) => e.category === c.id)),
    [cats, db]
  )

  // 简历模块自定义排列顺序
  const [orderedCatIds, setOrderedCatIds] = useState<string[]>(() =>
    availableCats.map((c) => c.id)
  )

  const [selectedCategories, setSelectedCategories] = useState<string[]>(() =>
    availableCats.map((c) => c.id)
  )

  useEffect(() => {
    const availIds = availableCats.map((c) => c.id)
    setOrderedCatIds((prev) => {
      const kept = prev.filter((id) => availIds.includes(id))
      const added = availIds.filter((id) => !kept.includes(id))
      return [...kept, ...added]
    })
    if (selectedCategories.length === 0 && availIds.length > 0) {
      setSelectedCategories(availIds)
    }
  }, [availableCats])

  const moveCategoryOrder = (catId: string, dir: -1 | 1) => {
    setOrderedCatIds((prev) => {
      const idx = prev.indexOf(catId)
      if (idx === -1) return prev
      const target = idx + dir
      if (target < 0 || target >= prev.length) return prev
      const next = [...prev]
      ;[next[idx], next[target]] = [next[target], next[idx]]
      return next
    })
  }

  const applyPresetOrder = (preset: 'academic' | 'job') => {
    const priority =
      preset === 'academic'
        ? ['education', 'publication', 'research', 'award', 'project', 'work', 'certificate', 'skill', 'campus']
        : ['education', 'work', 'project', 'skill', 'research', 'award', 'publication', 'certificate', 'campus']
    setOrderedCatIds((prev) => {
      return [...prev].sort((a, b) => {
        const ia = priority.indexOf(a)
        const ib = priority.indexOf(b)
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
      })
    })
    message.success(preset === 'academic' ? '已按「科研/保研优先」重排简历模块顺序' : '已按「求职/实习优先」重排简历模块顺序')
  }

  // 按 orderedCatIds 排序后的选中分类列表
  const orderedSelectedCategories = useMemo(
    () => orderedCatIds.filter((id) => selectedCategories.includes(id)),
    [orderedCatIds, selectedCategories]
  )

  // "精选条目" 模式
  const [customEntryMode, setCustomEntryMode] = useState(false)
  const [selectedEntryIds, setSelectedEntryIds] = useState<string[]>([])

  useEffect(() => {
    if (customEntryMode && selectedEntryIds.length === 0) {
      const allIds = (db?.entries ?? [])
        .filter((e) => selectedCategories.includes(e.category))
        .map((e) => e.id)
      setSelectedEntryIds(allIds)
    }
  }, [customEntryMode, selectedCategories, db])

  // ---- 预览与导出状态 ----
  const [html, setHtml] = useState('')
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [exportingPdf, setExportingPdf] = useState(false)
  const [exportingDocx, setExportingDocx] = useState(false)

  // ---- 证明材料打包导出状态 ----
  const entriesWithProofs = useMemo(
    () => (db?.entries ?? []).filter((e) => (e.attachments?.length ?? 0) > 0),
    [db?.entries]
  )
  const [proofEntryIds, setProofEntryIds] = useState<string[]>([])
  const [namingPattern, setNamingPattern] = useState<ExportProofsOptions['namingPattern']>('index_cat_title')
  const [includeIndexFile, setIncludeIndexFile] = useState(true)
  const [includeProfileAttachments, setIncludeProfileAttachments] = useState(false)
  const [exportingProofs, setExportingProofs] = useState(false)

  useEffect(() => {
    if (proofEntryIds.length === 0 && entriesWithProofs.length > 0) {
      setProofEntryIds(entriesWithProofs.map((e) => e.id))
    }
  }, [entriesWithProofs])

  // 实时预览重命名后的文件名列表
  const proofPreviewNames = useMemo(() => {
    const names: string[] = []
    if (includeIndexFile) {
      names.push('00_证明材料目录清单.txt')
    }
    let idx = 1
    if (includeProfileAttachments && (db?.profile.attachments.length ?? 0) > 0) {
      const pAtts = db?.profile.attachments ?? []
      const pad = String(idx).padStart(2, '0')
      pAtts.forEach((a, i) => {
        const ext = a.fileName.includes('.') ? '.' + a.fileName.split('.').pop() : ''
        const suffix = pAtts.length > 1 ? `_附件${i + 1}` : ''
        const base =
          namingPattern === 'cat_title'
            ? `基本信息_个人证件与基础材料`
            : namingPattern === 'index_title'
              ? `${pad}_个人证件与基础材料`
              : `${pad}_基本信息_个人证件与基础材料`
        names.push(`${base}${suffix}${ext}`)
      })
      idx++
    }
    const chosenSet = new Set(proofEntryIds)
    for (const cat of cats) {
      const catEntries = entriesWithProofs
        .filter((e) => e.category === cat.id && chosenSet.has(e.id))
        .sort((a, b) => a.order - b.order)
      for (const entry of catEntries) {
        const pad = String(idx).padStart(2, '0')
        const rawTitle = entryTitle(cat, entry.data).replace(/[\\/:*?"<>|]/g, '_')
        entry.attachments.forEach((a, i) => {
          const ext = a.fileName.includes('.') ? '.' + a.fileName.split('.').pop() : ''
          const suffix = entry.attachments.length > 1 ? `_附件${i + 1}` : ''
          const base =
            namingPattern === 'cat_title'
              ? `${cat.label}_${rawTitle}`
              : namingPattern === 'index_title'
                ? `${pad}_${rawTitle}`
                : `${pad}_${cat.label}_${rawTitle}`
          names.push(`${base}${suffix}${ext}`)
        })
        idx++
      }
    }
    return names
  }, [cats, db?.profile.attachments, entriesWithProofs, includeIndexFile, includeProfileAttachments, namingPattern, proofEntryIds])

  // ---- 备份与历史快照时光机状态 ----
  const [backingUp, setBackingUp] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([])
  const [loadingSnapshots, setLoadingSnapshots] = useState(false)
  const [restoringSnapId, setRestoringSnapId] = useState<string | null>(null)

  const reloadSnapshots = useCallback(async () => {
    setLoadingSnapshots(true)
    try {
      const list = await window.api.listSnapshots()
      setSnapshots(list)
    } catch {
      // ignore
    } finally {
      setLoadingSnapshots(false)
    }
  }, [])

  useEffect(() => {
    reloadSnapshots()
  }, [reloadSnapshots, db])

  const handleCreateSnapshotNow = async () => {
    try {
      const meta = await window.api.createSnapshot()
      await reloadSnapshots()
      if (meta) {
        message.success(`已创建历史快照（含 ${meta.entryCount} 条经历）`)
      }
    } catch (e) {
      message.error(errMsg(e))
    }
  }

  const handleRestoreSnapshot = async (snap: SnapshotMeta) => {
    setRestoringSnapId(snap.id)
    try {
      await window.api.restoreSnapshot(snap.id)
      await refresh()
      await reloadSnapshots()
      message.success(`已成功回滚至 ${snap.createdAt.slice(0, 19).replace('T', ' ')} 的历史快照版本！`)
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setRestoringSnapId(null)
    }
  }

  const resumeOpts: ExportResumeOptions = useMemo(
    () => ({
      title: title.trim() || undefined,
      includePhoto,
      theme,
      density,
      categories: orderedSelectedCategories,
      entryIds: customEntryMode ? selectedEntryIds : undefined
    }),
    [title, includePhoto, theme, density, orderedSelectedCategories, customEntryMode, selectedEntryIds]
  )

  useEffect(() => {
    let active = true
    setLoadingPreview(true)

    const timer = setTimeout(async () => {
      try {
        if (selectedCategories.length === 0) {
          if (active) {
            setHtml(
              '<div style="display:flex;justify-content:center;align-items:center;height:100%;color:#999;font-family:sans-serif;">请至少选择一个分类以生成简历预览</div>'
            )
            setLoadingPreview(false)
          }
          return
        }
        const res = await window.api.resumeHtml(resumeOpts)
        if (active) {
          setHtml(res)
          setLoadingPreview(false)
        }
      } catch (e) {
        if (active) {
          setHtml(`<div style="color:#ff4d4f;padding:24px;font-family:sans-serif;">生成预览失败：${errMsg(e)}</div>`)
          setLoadingPreview(false)
        }
      }
    }, 400)

    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [resumeOpts])

  const handleDeAiScan = async () => {
    setDeAiLoading(true)
    try {
      const targetIds = customEntryMode ? selectedEntryIds : undefined
      const patches = await window.api.deAiResumePreview(targetIds)
      if (patches.length === 0) {
        message.success('当前简历措辞已十分平实自然，未检测到需要改写的浮夸 AI 套话')
        return
      }
      setDeAiPatches(patches)
      setDeAiModalOpen(true)
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setDeAiLoading(false)
    }
  }

  const handleApplyDeAi = async () => {
    setApplyingDeAi(true)
    try {
      await window.api.applyDeAiPatches(deAiPatches)
      setDeAiModalOpen(false)
      await refresh()
      const res = await window.api.resumeHtml(resumeOpts)
      setHtml(res)
      message.success(`已将 ${deAiPatches.length} 处段落改写为真人平实表达并更新至资料库`)
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setApplyingDeAi(false)
    }
  }

  const handleExportPdf = async () => {
    setExportingPdf(true)
    try {
      const out = await window.api.exportResumePdf(resumeOpts)
      if (out) {
        message.success(`PDF 简历导出成功：${out}`)
      }
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setExportingPdf(false)
    }
  }

  const handleExportDocx = async () => {
    setExportingDocx(true)
    try {
      const out = await window.api.exportResumeDocx(resumeOpts)
      if (out) {
        message.success(`Word 简历导出成功：${out}`)
      }
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setExportingDocx(false)
    }
  }

  const handleExportProofs = async () => {
    if (proofEntryIds.length === 0 && !includeProfileAttachments) {
      message.warning('请至少勾选一条带有证明附件的条目')
      return
    }
    setExportingProofs(true)
    try {
      const out = await window.api.exportProofsBundle({
        entryIds: proofEntryIds,
        namingPattern,
        includeIndexFile,
        includeProfileAttachments
      })
      if (out) {
        message.success(`证明材料包已导出（含 ${out.fileCount} 个证明文件）：${out.outPath}`)
      }
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setExportingProofs(false)
    }
  }

  const handleBackup = async () => {
    setBackingUp(true)
    try {
      const out = await window.api.backupZip()
      if (out) {
        message.success(`备份文件已保存至：${out}`)
      }
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setBackingUp(false)
    }
  }

  const handleRestore = async () => {
    setRestoring(true)
    try {
      const ok = await window.api.restoreZip()
      if (ok) {
        await refresh()
        message.success('已成功从备份恢复全部资料')
      }
    } catch (e) {
      message.error(errMsg(e))
    } finally {
      setRestoring(false)
    }
  }

  return (
    <div className="page">
      <div className="page-header">
        <h2>
          <ExportOutlined /> 导出与备份
        </h2>
      </div>

      <Space direction="vertical" style={{ width: '100%' }} size={20}>
        {/* 导出简历 Card */}
        <Card
          title="导出简历（真人干练排版 · 去 AI 模板感）"
          size="small"
          extra={
            <Button
              size="small"
              type="primary"
              ghost
              icon={<ClearOutlined />}
              loading={deAiLoading}
              onClick={handleDeAiScan}
            >
              🧹 一键去除简历文字 AI 味
            </Button>
          }
        >
          <Row gutter={[20, 20]}>
            {/* 左侧选项 */}
            <Col xs={24} md={10}>
              <Space direction="vertical" style={{ width: '100%' }} size={16}>
                <div>
                  <div style={{ marginBottom: 6, fontWeight: 500 }}>排版风格：</div>
                  <Radio.Group
                    value={theme}
                    onChange={(e) => setTheme(e.target.value)}
                    optionType="button"
                    buttonStyle="solid"
                    size="small"
                    options={[
                      { label: '经典干练黑白（推荐）', value: 'classic' },
                      { label: '现代深蓝', value: 'modern' },
                      { label: '学术衬线风', value: 'academic' }
                    ]}
                  />
                </div>

                <div>
                  <div style={{ marginBottom: 6, fontWeight: 500 }}>
                    排版紧凑度（一页纸自适应调节）：
                  </div>
                  <Radio.Group
                    value={density}
                    onChange={(e) => setDensity(e.target.value)}
                    optionType="button"
                    buttonStyle="solid"
                    size="small"
                    options={[
                      { label: '⚡ 紧凑一页纸（防超页）', value: 'compact' },
                      { label: '📄 标准适中', value: 'normal' },
                      { label: '🌿 舒展充实', value: 'loose' }
                    ]}
                  />
                </div>

                <div>
                  <div style={{ marginBottom: 6, fontWeight: 500 }}>简历标题（可选）：</div>
                  <Input
                    placeholder="如：求职意向：前端开发工程师"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    allowClear
                  />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 500 }}>包含证件照片：</span>
                  <Switch checked={includePhoto} onChange={setIncludePhoto} />
                </div>

                <div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      marginBottom: 8,
                      flexWrap: 'wrap',
                      gap: 6
                    }}
                  >
                    <span style={{ fontWeight: 500 }}>导出模块与顺序调整：</span>
                    <Space size={6} wrap>
                      <Tag
                        color="blue"
                        style={{ cursor: 'pointer', margin: 0 }}
                        onClick={() => applyPresetOrder('academic')}
                      >
                        🎓 科研/保研排序
                      </Tag>
                      <Tag
                        color="cyan"
                        style={{ cursor: 'pointer', margin: 0 }}
                        onClick={() => applyPresetOrder('job')}
                      >
                        💼 求职/实习排序
                      </Tag>
                      <a
                        onClick={() => setSelectedCategories(availableCats.map((c) => c.id))}
                        style={{ fontSize: 12 }}
                      >
                        全选
                      </a>
                      <a onClick={() => setSelectedCategories([])} style={{ fontSize: 12 }}>
                        清空
                      </a>
                    </Space>
                  </div>
                  {availableCats.length === 0 ? (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description="暂无包含条目的分类"
                      style={{ margin: '8px 0' }}
                    />
                  ) : (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                        padding: '8px 10px',
                        background: '#fafafa',
                        borderRadius: 6,
                        border: '1px solid #f0f0f0'
                      }}
                    >
                      {orderedCatIds.map((catId, idx) => {
                        const c = availableCats.find((x) => x.id === catId)
                        if (!c) return null
                        const checked = selectedCategories.includes(c.id)
                        const entryCount = (db?.entries ?? []).filter((e) => e.category === c.id).length
                        return (
                          <div
                            key={c.id}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '3px 6px',
                              background: checked ? '#ffffff' : 'transparent',
                              borderRadius: 4,
                              border: checked ? '1px solid #e6f4ff' : '1px solid transparent'
                            }}
                          >
                            <Checkbox
                              checked={checked}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedCategories((prev) => [...prev, c.id])
                                } else {
                                  setSelectedCategories((prev) => prev.filter((id) => id !== c.id))
                                }
                              }}
                            >
                              <span style={{ fontWeight: checked ? 500 : 400 }}>
                                {c.label}{' '}
                                <span className="muted" style={{ fontSize: 12 }}>
                                  ({entryCount})
                                </span>
                              </span>
                            </Checkbox>
                            <Space size={2}>
                              <Tooltip title="上移该模块">
                                <Button
                                  size="small"
                                  type="text"
                                  disabled={idx === 0}
                                  icon={<ArrowUpOutlined style={{ fontSize: 12 }} />}
                                  onClick={() => moveCategoryOrder(c.id, -1)}
                                />
                              </Tooltip>
                              <Tooltip title="下移该模块">
                                <Button
                                  size="small"
                                  type="text"
                                  disabled={idx === orderedCatIds.length - 1}
                                  icon={<ArrowDownOutlined style={{ fontSize: 12 }} />}
                                  onClick={() => moveCategoryOrder(c.id, 1)}
                                />
                              </Tooltip>
                            </Space>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>

                <Divider style={{ margin: '8px 0' }} />

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <Space direction="vertical" size={2}>
                    <span style={{ fontWeight: 500 }}>精选条目模式</span>
                    <span className="muted" style={{ fontSize: 12 }}>
                      自定义勾选每个分类下具体呈现的条目
                    </span>
                  </Space>
                  <Switch checked={customEntryMode} onChange={setCustomEntryMode} />
                </div>

                {customEntryMode && (
                  <div
                    style={{
                      maxHeight: 240,
                      overflowY: 'auto',
                      padding: '8px 12px',
                      background: '#f9fbfd',
                      borderRadius: 6,
                      border: '1px solid #e8e8e8'
                    }}
                  >
                    {selectedCategories.length === 0 ? (
                      <span className="muted" style={{ fontSize: 13 }}>
                        请先选择上方分类
                      </span>
                    ) : (
                      selectedCategories.map((catId) => {
                        const catDef = cats.find((c) => c.id === catId)
                        const entries = (db?.entries ?? []).filter((e) => e.category === catId)
                        if (entries.length === 0) return null
                        return (
                          <div key={catId} style={{ marginBottom: 12 }}>
                            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>
                              {catDef?.label}
                            </div>
                            <Space direction="vertical" style={{ width: '100%', paddingLeft: 8 }} size={4}>
                              {entries.map((entry) => {
                                const checked = selectedEntryIds.includes(entry.id)
                                return (
                                  <Checkbox
                                    key={entry.id}
                                    checked={checked}
                                    onChange={(e) => {
                                      if (e.target.checked) {
                                        setSelectedEntryIds((prev) => [...prev, entry.id])
                                      } else {
                                        setSelectedEntryIds((prev) =>
                                          prev.filter((id) => id !== entry.id)
                                        )
                                      }
                                    }}
                                  >
                                    <span style={{ fontSize: 13 }}>
                                      {entryTitle(catDef, entry.data)}
                                    </span>
                                  </Checkbox>
                                )
                              })}
                            </Space>
                          </div>
                        )
                      })
                    )}
                  </div>
                )}

                <Divider style={{ margin: '8px 0' }} />

                <Space style={{ width: '100%' }} size={12}>
                  <Button
                    type="primary"
                    icon={<FilePdfOutlined />}
                    size="large"
                    loading={exportingPdf}
                    disabled={selectedCategories.length === 0}
                    onClick={handleExportPdf}
                    style={{ flex: 1 }}
                  >
                    导出 PDF
                  </Button>
                  <Button
                    icon={<FileWordOutlined />}
                    size="large"
                    loading={exportingDocx}
                    disabled={selectedCategories.length === 0}
                    onClick={handleExportDocx}
                    style={{ flex: 1 }}
                  >
                    导出 Word
                  </Button>
                </Space>
              </Space>
            </Col>

            {/* 右侧预览区 */}
            <Col xs={24} md={14}>
              <div
                style={{
                  position: 'relative',
                  width: '100%',
                  height: 720,
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
                  borderRadius: 8
                }}
              >
                {loadingPreview && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      background: 'rgba(255, 255, 255, 0.7)',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      justifyContent: 'center',
                      zIndex: 2,
                      borderRadius: 8
                    }}
                  >
                    <Spin tip="正在更新简历预览…" />
                  </div>
                )}
                <iframe
                  srcDoc={html}
                  sandbox=""
                  title="简历预览"
                  style={{
                    width: '100%',
                    height: 720,
                    border: '1px solid #d9d9d9',
                    borderRadius: 8,
                    background: '#fff',
                    display: 'block'
                  }}
                />
              </div>
            </Col>
          </Row>
        </Card>

        {/* 导出证明材料包 Card（用于奖学金/保研/资格审查上交） */}
        <Card
          title="导出证明材料包（按规范重命名打包，用于上交审核）"
          size="small"
          extra={<Tag color="blue">自动编号 + 目录清单</Tag>}
        >
          <Row gutter={[20, 16]}>
            <Col xs={24} md={12}>
              <Space direction="vertical" style={{ width: '100%' }} size={12}>
                <div>
                  <div style={{ fontWeight: 500, marginBottom: 6 }}>附件重命名格式：</div>
                  <Radio.Group
                    value={namingPattern}
                    onChange={(e) => setNamingPattern(e.target.value)}
                    options={[
                      { label: '01_分类_标题.ext（推荐）', value: 'index_cat_title' },
                      { label: '01_标题.ext', value: 'index_title' },
                      { label: '分类_标题.ext', value: 'cat_title' }
                    ]}
                  />
                </div>

                <Space wrap size={20}>
                  <Checkbox
                    checked={includeIndexFile}
                    onChange={(e) => setIncludeIndexFile(e.target.checked)}
                  >
                    生成《00_证明材料目录清单.txt》
                  </Checkbox>
                  <Checkbox
                    checked={includeProfileAttachments}
                    onChange={(e) => setIncludeProfileAttachments(e.target.checked)}
                  >
                    包含基本信息证件附件 ({db?.profile.attachments.length ?? 0})
                  </Checkbox>
                </Space>

                <div>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      marginBottom: 6
                    }}
                  >
                    <span style={{ fontWeight: 500 }}>
                      勾选需要打包的证明条目（共 {entriesWithProofs.length} 条含附件）：
                    </span>
                    <Space size={8}>
                      <a
                        onClick={() => setProofEntryIds(entriesWithProofs.map((e) => e.id))}
                        style={{ fontSize: 12 }}
                      >
                        全选
                      </a>
                      <a onClick={() => setProofEntryIds([])} style={{ fontSize: 12 }}>
                        清空
                      </a>
                    </Space>
                  </div>

                  {entriesWithProofs.length === 0 ? (
                    <Empty
                      image={Empty.PRESENTED_IMAGE_SIMPLE}
                      description="当前没有挂载证明文件的条目，请先在各分类条目中添加证书或证明图片/PDF"
                    />
                  ) : (
                    <div
                      style={{
                        maxHeight: 200,
                        overflowY: 'auto',
                        padding: '8px 12px',
                        border: '1px solid #e8e8e8',
                        borderRadius: 6,
                        background: '#fafafa'
                      }}
                    >
                      <Space direction="vertical" size={6} style={{ width: '100%' }}>
                        {entriesWithProofs.map((entry) => {
                          const cat = cats.find((c) => c.id === entry.category)
                          const checked = proofEntryIds.includes(entry.id)
                          return (
                            <Checkbox
                              key={entry.id}
                              checked={checked}
                              onChange={(ev) => {
                                if (ev.target.checked) {
                                  setProofEntryIds((prev) => [...prev, entry.id])
                                } else {
                                  setProofEntryIds((prev) => prev.filter((id) => id !== entry.id))
                                }
                              }}
                            >
                              <Space size={6}>
                                <Tag style={{ margin: 0 }}>{cat?.label ?? entry.category}</Tag>
                                <span style={{ fontSize: 13 }}>{entryTitle(cat, entry.data)}</span>
                                <span className="muted" style={{ fontSize: 12 }}>
                                  ({entry.attachments.length} 个文件)
                                </span>
                              </Space>
                            </Checkbox>
                          )
                        })}
                      </Space>
                    </div>
                  )}
                </div>

                <Button
                  type="primary"
                  icon={<FileZipOutlined />}
                  loading={exportingProofs}
                  disabled={entriesWithProofs.length === 0 && !includeProfileAttachments}
                  onClick={handleExportProofs}
                >
                  打包导出证明材料 ZIP
                </Button>
              </Space>
            </Col>

            <Col xs={24} md={12}>
              <div style={{ fontWeight: 500, marginBottom: 6 }}>
                打包后文件清单预览（共 {proofPreviewNames.length} 个文件）：
              </div>
              <div
                style={{
                  height: 265,
                  overflowY: 'auto',
                  padding: '10px 14px',
                  background: '#1e293b',
                  color: '#e2e8f0',
                  borderRadius: 6,
                  fontFamily: 'Consolas, monospace',
                  fontSize: 12,
                  lineHeight: 1.7
                }}
              >
                {proofPreviewNames.length === 0 ? (
                  <span style={{ color: '#94a3b8' }}>// 请勾选左侧含附件的条目以预览重命名效果</span>
                ) : (
                  proofPreviewNames.map((n, i) => <div key={i}>📄 {n}</div>)
                )}
              </div>
            </Col>
          </Row>
        </Card>

        {/* 历史快照时光机 Card */}
        <Card
          title={
            <Space>
              <HistoryOutlined style={{ color: '#1f4e79' }} />
              <span>🕒 历史快照「时光机」（自动防丢 · 一键可视化回滚）</span>
              <Tag color="green">最多保留最近 20 个历史版本</Tag>
            </Space>
          }
          size="small"
          extra={
            <Button
              size="small"
              type="primary"
              ghost
              icon={<PlusCircleOutlined />}
              onClick={handleCreateSnapshotNow}
            >
              立即创建当前快照
            </Button>
          }
        >
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            <div className="muted" style={{ fontSize: 12 }}>
              系统在您修改资料时会自动在后台保存历史快照。若发生误删、误改，可随时点击右侧「一键回滚」恢复到任意历史时刻（回滚前会自动为您保存一份当前状态快照，可随时反悔）。
            </div>
            {snapshots.length === 0 ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={loadingSnapshots ? '正在读取历史快照…' : '暂无历史快照，可点击右上角「立即创建当前快照」'}
              />
            ) : (
              <List
                size="small"
                style={{
                  maxHeight: 280,
                  overflowY: 'auto',
                  border: '1px solid #f0f0f0',
                  borderRadius: 6,
                  background: '#fafafa',
                  padding: '4px 12px'
                }}
                dataSource={snapshots}
                renderItem={(snap, idx) => {
                  const localTime = new Date(snap.createdAt).toLocaleString('zh-CN', {
                    hour12: false
                  })
                  return (
                    <List.Item
                      actions={[
                        <Popconfirm
                          key="restore"
                          title="确定回滚到此历史快照版本？"
                          description="回滚前系统会自动为您创建一份当前状态的快照，确保绝对安全。"
                          onConfirm={() => handleRestoreSnapshot(snap)}
                          okText="确认回滚"
                          cancelText="取消"
                        >
                          <Button
                            size="small"
                            type="primary"
                            ghost
                            icon={<RollbackOutlined />}
                            loading={restoringSnapId === snap.id}
                          >
                            一键回滚到此版本
                          </Button>
                        </Popconfirm>
                      ]}
                    >
                      <List.Item.Meta
                        title={
                          <Space wrap size={8}>
                            <Typography.Text strong>{localTime}</Typography.Text>
                            {idx === 0 && <Tag color="blue">最近快照</Tag>}
                            <Tag>{snap.profileName}</Tag>
                            <Tag color="cyan">{snap.entryCount} 条经历</Tag>
                            <span className="muted" style={{ fontSize: 11 }}>
                              ({(snap.size / 1024).toFixed(1)} KB)
                            </span>
                          </Space>
                        }
                        description={
                          <div style={{ fontSize: 12, color: '#595959' }}>{snap.summary}</div>
                        }
                      />
                    </List.Item>
                  )
                }}
              />
            )}
          </Space>
        </Card>

        {/* 备份与恢复 Card */}
        <Card title="导出完整备份包（含证明原件 ZIP）" size="small">
          <Space direction="vertical" style={{ width: '100%' }} size={16}>
            <Alert
              type="info"
              showIcon
              message="备份说明"
              description="备份文件为标准 ZIP 压缩包，包含个人全部基本信息、分类经历记录、文案库以及关联的所有证明原件（图片与附件）。还原时系统会自动对现有数据执行一次临时备份，确保数据绝对安全。"
            />

            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              <Button
                type="primary"
                icon={<CloudDownloadOutlined />}
                size="middle"
                loading={backingUp}
                onClick={handleBackup}
              >
                导出备份 ZIP
              </Button>

              <Button
                icon={<CloudUploadOutlined />}
                size="middle"
                loading={restoring}
                onClick={handleRestore}
              >
                从备份恢复
              </Button>
            </div>
          </Space>
        </Card>
      </Space>

      {/* 简历去 AI 味预览对比弹窗 */}
      <Modal
        open={deAiModalOpen}
        title={`🧹 去除简历文字 AI 味对比预览（共优化 ${deAiPatches.length} 处）`}
        width={760}
        onCancel={() => setDeAiModalOpen(false)}
        onOk={handleApplyDeAi}
        confirmLoading={applyingDeAi}
        okText="确认应用并更新简历"
        cancelText="取消"
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="已自动剔除“赋能、抓手、闭环、全方位、卓越”等 AI 套话与过度吹捧，改写为真人手写简历的平实干练表达（可在下方继续微调）："
        />
        <div style={{ maxHeight: '62vh', overflowY: 'auto', paddingRight: 4 }}>
          <List
            size="small"
            dataSource={deAiPatches}
            renderItem={(item, idx) => (
              <List.Item style={{ padding: '10px 0' }}>
                <div style={{ width: '100%' }}>
                  <Space style={{ marginBottom: 6 }}>
                    <Tag color="blue">{item.title}</Tag>
                    <Typography.Text strong style={{ fontSize: 13 }}>
                      {item.fieldLabel}
                    </Typography.Text>
                  </Space>
                  <Row gutter={12}>
                    <Col xs={24} md={11}>
                      <div className="muted" style={{ fontSize: 12, marginBottom: 4 }}>
                        原表述：
                      </div>
                      <div
                        className="pre-wrap"
                        style={{
                          padding: '8px 10px',
                          background: '#fff1f0',
                          border: '1px solid #ffa39e',
                          borderRadius: 6,
                          fontSize: 12.5,
                          color: '#434343'
                        }}
                      >
                        {item.original}
                      </div>
                    </Col>
                    <Col xs={24} md={13}>
                      <div style={{ fontSize: 12, marginBottom: 4, color: '#389e0d', fontWeight: 500 }}>
                        去 AI 味后平实表述（可编辑）：
                      </div>
                      <Input.TextArea
                        autoSize={{ minRows: 2, maxRows: 6 }}
                        value={item.revised}
                        onChange={(e) => {
                          const v = e.target.value
                          setDeAiPatches((prev) =>
                            prev.map((p, i) => (i === idx ? { ...p, revised: v } : p))
                          )
                        }}
                        style={{ fontSize: 12.5 }}
                      />
                    </Col>
                  </Row>
                </div>
              </List.Item>
            )}
          />
        </div>
      </Modal>
    </div>
  )
}
