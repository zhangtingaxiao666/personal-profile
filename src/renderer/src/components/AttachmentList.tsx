import { App, Button, Empty, Image, List, Modal, Popconfirm, Space, Spin, Tooltip, Typography } from 'antd'
import {
  CopyOutlined,
  DeleteOutlined,
  EyeOutlined,
  FilePdfOutlined,
  FileImageOutlined,
  FileOutlined,
  FolderOpenOutlined,
  PaperClipOutlined
} from '@ant-design/icons'
import { useState } from 'react'
import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { Attachment } from '@shared/types'
import type { AttachTarget } from '@shared/ipc'
import { errMsg } from '../store'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

function iconOf(mime: string) {
  if (mime.startsWith('image/')) return <FileImageOutlined style={{ color: '#13a8a8' }} />
  if (mime === 'application/pdf') return <FilePdfOutlined style={{ color: '#cf1322' }} />
  return <FileOutlined />
}

function sizeText(n: number) {
  if (n < 1024) return n + ' B'
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB'
  return (n / 1024 / 1024).toFixed(1) + ' MB'
}

function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl
  const bin = atob(base64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i)
  }
  return bytes
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(new Error('读取剪贴板图片失败'))
    reader.readAsDataURL(blob)
  })
}

interface Props {
  target: AttachTarget
  attachments: Attachment[]
  onChanged: () => void
}

/** 证明文件列表：上传、拖拽、剪贴板粘贴截图、图片与 PDF 应用内预览、打开、删除 */
export default function AttachmentList({ target, attachments, onChanged }: Props) {
  const { message } = App.useApp()
  const [preview, setPreview] = useState<string | null>(null)
  const [pdfPreview, setPdfPreview] = useState<{
    open: boolean
    title: string
    relPath: string
    loading: boolean
    pages: string[]
  }>({ open: false, title: '', relPath: '', loading: false, pages: [] })
  const [drag, setDrag] = useState(false)

  const add = async (paths: string[]) => {
    if (!paths.length) return
    try {
      await window.api.addAttachments(target, paths)
      message.success(`已添加 ${paths.length} 个证明文件`)
      onChanged()
    } catch (e) {
      message.error(errMsg(e))
    }
  }

  const addBase64Image = async (dataUrl: string, fileName?: string) => {
    try {
      await window.api.addAttachmentFromBase64(target, dataUrl, fileName)
      message.success('已从剪贴板添加截图证明')
      onChanged()
    } catch (e) {
      message.error(errMsg(e))
    }
  }

  const handlePasteFromClipboardButton = async () => {
    try {
      if (!navigator.clipboard?.read) {
        message.warning('当前环境不支持直接读取剪贴板，请点击虚线框后按 Ctrl+V 粘贴')
        return
      }
      const items = await navigator.clipboard.read()
      for (const item of items) {
        const imgType = item.types.find((t) => t.startsWith('image/'))
        if (imgType) {
          const blob = await item.getType(imgType)
          const dataUrl = await blobToDataUrl(blob)
          await addBase64Image(dataUrl)
          return
        }
      }
      message.warning('剪贴板中未检测到截图或图片，请先截图后再粘贴')
    } catch (e) {
      message.error(errMsg(e))
    }
  }

  const openPdfPreview = async (a: Attachment) => {
    setPdfPreview({ open: true, title: a.fileName, relPath: a.relPath, loading: true, pages: [] })
    try {
      const dataUrl = await window.api.attachmentDataUrl(a.relPath)
      if (!dataUrl) throw new Error('未能读取 PDF 文件内容')
      const data = dataUrlToUint8Array(dataUrl)
      const loadingTask = pdfjs.getDocument({ data })
      const doc = await loadingTask.promise
      try {
        const pages: string[] = []
        const maxPages = Math.min(doc.numPages, 10)
        for (let i = 1; i <= maxPages; i++) {
          const page = await doc.getPage(i)
          const unscaled = page.getViewport({ scale: 1 })
          const scale = 1200 / (unscaled.width || 1200)
          const viewport = page.getViewport({ scale })
          const canvas = document.createElement('canvas')
          canvas.width = Math.floor(viewport.width)
          canvas.height = Math.floor(viewport.height)
          await page.render({ canvas, viewport }).promise
          pages.push(canvas.toDataURL('image/png'))
        }
        setPdfPreview({ open: true, title: a.fileName, relPath: a.relPath, loading: false, pages })
      } finally {
        await doc.cleanup()
        await loadingTask.destroy()
      }
    } catch (e) {
      message.error('PDF 预览加载失败：' + errMsg(e))
      setPdfPreview((p) => ({ ...p, open: false, loading: false }))
    }
  }

  return (
    <div
      tabIndex={0}
      onPaste={async (e) => {
        const items = Array.from(e.clipboardData?.items ?? [])
        const imgItem = items.find((it) => it.type.startsWith('image/'))
        if (imgItem) {
          e.preventDefault()
          const file = imgItem.getAsFile()
          if (file) {
            const dataUrl = await blobToDataUrl(file)
            await addBase64Image(dataUrl, file.name && file.name !== 'image.png' ? file.name : undefined)
          }
        }
      }}
      onDragOver={(e) => {
        e.preventDefault()
        setDrag(true)
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDrag(false)
        add(Array.from(e.dataTransfer.files).map((f) => window.api.getPathForFile(f)))
      }}
      style={{
        border: `1px dashed ${drag ? '#1f4e79' : '#d9d9d9'}`,
        borderRadius: 8,
        padding: 8,
        background: drag ? '#eef4fa' : undefined,
        outline: 'none'
      }}
    >
      <List
        size="small"
        dataSource={attachments}
        locale={{ emptyText: <span className="muted">暂无证明文件，支持拖拽文件或 Ctrl+V 直接粘贴截图</span> }}
        renderItem={(a) => (
          <List.Item
            actions={[
              (a.mime.startsWith('image/') || a.mime === 'application/pdf') && (
                <Tooltip title={a.mime === 'application/pdf' ? '应用内预览 PDF' : '预览图片'} key="p">
                  <Button
                    size="small"
                    type="text"
                    icon={<EyeOutlined />}
                    onClick={async () => {
                      if (a.mime === 'application/pdf') {
                        await openPdfPreview(a)
                      } else {
                        setPreview(await window.api.attachmentDataUrl(a.relPath))
                      }
                    }}
                  />
                </Tooltip>
              ),
              <Tooltip title="在文件夹中显示" key="f">
                <Button size="small" type="text" icon={<FolderOpenOutlined />} onClick={() => window.api.showAttachmentInFolder(a.relPath)} />
              </Tooltip>,
              <Popconfirm key="d" title="删除该证明文件？" onConfirm={async () => (await window.api.removeAttachment(target, a.id), onChanged())}>
                <Button size="small" type="text" danger icon={<DeleteOutlined />} />
              </Popconfirm>
            ].filter(Boolean)}
          >
            <Space>
              {iconOf(a.mime)}
              <Typography.Link onClick={() => window.api.openAttachment(a.relPath).catch((e) => message.error(errMsg(e)))}>
                {a.fileName}
              </Typography.Link>
              <span className="muted" style={{ fontSize: 12 }}>
                {sizeText(a.size)}
              </span>
            </Space>
          </List.Item>
        )}
      />
      <Space style={{ width: '100%', marginTop: 4 }} size={8}>
        <Button
          type="dashed"
          icon={<PaperClipOutlined />}
          onClick={async () => add(await window.api.pickFiles())}
          style={{ flex: 1 }}
        >
          选择证明文件
        </Button>
        <Tooltip title="也可点击此区域后直接按 Ctrl+V 粘贴截图">
          <Button
            type="dashed"
            icon={<CopyOutlined />}
            onClick={handlePasteFromClipboardButton}
          >
            粘贴剪贴板截图
          </Button>
        </Tooltip>
      </Space>

      {preview && (
        <Image style={{ display: 'none' }} src={preview} preview={{ open: true, onOpenChange: (v) => !v && setPreview(null) }} />
      )}

      <Modal
        open={pdfPreview.open}
        title={`PDF 预览：${pdfPreview.title}`}
        width={820}
        onCancel={() => setPdfPreview((p) => ({ ...p, open: false }))}
        footer={[
          <Button
            key="ext"
            onClick={() => window.api.openAttachment(pdfPreview.relPath).catch((e) => message.error(errMsg(e)))}
          >
            用系统默认阅读器打开
          </Button>,
          <Button key="close" type="primary" onClick={() => setPdfPreview((p) => ({ ...p, open: false }))}>
            关闭
          </Button>
        ]}
      >
        {pdfPreview.loading ? (
          <div style={{ padding: 48, textAlign: 'center' }}>
            <Spin tip="正在渲染 PDF 页面…" />
          </div>
        ) : pdfPreview.pages.length === 0 ? (
          <Empty description="未能渲染出 PDF 页面" />
        ) : (
          <div style={{ maxHeight: '70vh', overflowY: 'auto', background: '#f5f5f5', padding: 12, borderRadius: 6 }}>
            {pdfPreview.pages.map((src, idx) => (
              <div key={idx} style={{ marginBottom: 12, textAlign: 'center' }}>
                <img
                  src={src}
                  alt={`第 ${idx + 1} 页`}
                  style={{ maxWidth: '100%', borderRadius: 4, boxShadow: '0 2px 6px rgba(0,0,0,0.12)' }}
                />
                <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>
                  第 {idx + 1} 页
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  )
}
