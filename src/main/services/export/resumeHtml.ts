import fs from 'fs'
import path from 'path'
import type { Database, ExportResumeOptions, ResumeDensity, ResumeTheme } from '@shared/types'
import { buildResumeModel } from './resumeModel'

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function getThemeVars(theme: ResumeTheme) {
  if (theme === 'modern') {
    return {
      accent: '#1f4e79',
      titleColor: '#1f4e79',
      borderRule: '1.5px solid #1f4e79',
      fontFamily: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif',
      headerAlign: 'left'
    }
  }
  if (theme === 'academic') {
    return {
      accent: '#111111',
      titleColor: '#000000',
      borderRule: '1px solid #222222',
      fontFamily: '"Songti SC", "SimSun", "STSong", "Microsoft YaHei", serif',
      headerAlign: 'left'
    }
  }
  // classic: 经典干练黑白风（最接近真人手写 LaTeX/Word 高分简历，毫无 AI 模板味）
  return {
    accent: '#18181b',
    titleColor: '#111827',
    borderRule: '1.5px solid #27272a',
    fontFamily: '"Source Han Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif',
    headerAlign: 'left'
  }
}

function getDensityVars(density: ResumeDensity) {
  if (density === 'compact') {
    return {
      pageMargin: '8mm 11mm',
      pagePadding: '9mm 11mm',
      bodyFontSize: '12px',
      bodyLineHeight: '1.36',
      nameFontSize: '20px',
      metaFontSize: '11.8px',
      metaLineHeight: '1.42',
      photoWidth: '68px',
      photoHeight: '92px',
      sectionMarginTop: '7px',
      sectionTitleSize: '13.4px',
      sectionTitleMarginBottom: '4px',
      itemMarginBottom: '4px',
      itemCompactMarginBottom: '1.5px',
      itemTitleSize: '12.6px',
      itemSubSize: '11.8px',
      lineFontSize: '12px',
      lineHeight: '1.35',
      lineMarginBottom: '0.5px'
    }
  }
  if (density === 'loose') {
    return {
      pageMargin: '15mm 16mm',
      pagePadding: '16mm 18mm',
      bodyFontSize: '13.6px',
      bodyLineHeight: '1.65',
      nameFontSize: '25px',
      metaFontSize: '13px',
      metaLineHeight: '1.7',
      photoWidth: '88px',
      photoHeight: '118px',
      sectionMarginTop: '15px',
      sectionTitleSize: '15.2px',
      sectionTitleMarginBottom: '9px',
      itemMarginBottom: '10px',
      itemCompactMarginBottom: '5px',
      itemTitleSize: '14px',
      itemSubSize: '13px',
      lineFontSize: '13.2px',
      lineHeight: '1.6',
      lineMarginBottom: '3px'
    }
  }
  // normal
  return {
    pageMargin: '12mm 14mm',
    pagePadding: '13mm 15mm',
    bodyFontSize: '13px',
    bodyLineHeight: '1.52',
    nameFontSize: '23px',
    metaFontSize: '12.5px',
    metaLineHeight: '1.6',
    photoWidth: '82px',
    photoHeight: '110px',
    sectionMarginTop: '11px',
    sectionTitleSize: '14.5px',
    sectionTitleMarginBottom: '7px',
    itemMarginBottom: '7px',
    itemCompactMarginBottom: '3px',
    itemTitleSize: '13.5px',
    itemSubSize: '12.5px',
    lineFontSize: '12.8px',
    lineHeight: '1.48',
    lineMarginBottom: '1.5px'
  }
}

export function buildResumeHtml(
  db: Database,
  opts: ExportResumeOptions,
  absOf: (rel: string) => string
): string {
  const model = buildResumeModel(db, opts, absOf)
  const tv = getThemeVars(model.theme)
  const dv = getDensityVars(model.density)

  let photoDataUrl: string | undefined
  if (model.photoAbsPath) {
    try {
      if (fs.existsSync(model.photoAbsPath)) {
        const ext = path.extname(model.photoAbsPath).toLowerCase()
        const mime =
          ext === '.png'
            ? 'image/png'
            : ext === '.gif'
              ? 'image/gif'
              : ext === '.bmp'
                ? 'image/bmp'
                : ext === '.webp'
                  ? 'image/webp'
                  : 'image/jpeg'
        const buf = fs.readFileSync(model.photoAbsPath)
        photoDataUrl = `data:${mime};base64,${buf.toString('base64')}`
      }
    } catch {
      // ignore
    }
  }

  const allMetaItems: string[] = [
    ...model.contacts.map((c) => escapeHtml(c)),
    ...model.infoPairs.map((p) => `${escapeHtml(p.label)}：${escapeHtml(p.value)}`)
  ]
  const metaHtml =
    allMetaItems.length > 0
      ? `<div class="meta-line">${allMetaItems.join('<span class="meta-sep">｜</span>')}</div>`
      : ''

  const photoHtml = photoDataUrl
    ? `<div class="header-photo"><img src="${photoDataUrl}" alt="照片" /></div>`
    : ''

  const summaryHtml = model.summary
    ? `<div class="section">
        <div class="section-title">个人总结</div>
        <div class="summary-text">${escapeHtml(model.summary)}</div>
      </div>`
    : ''

  const sectionsHtml = model.sections
    .map((sec) => {
      const itemsHtml = sec.items
        .map((item) => {
          if (item.compactInline) {
            return `<div class="item item-compact">
              <div class="item-header">
                <div class="item-left">
                  <span class="item-title">${escapeHtml(item.title)}</span>
                  ${item.subtitle ? `<span class="item-inline-sub">${escapeHtml(item.subtitle)}</span>` : ''}
                </div>
                ${item.period ? `<span class="item-period">${escapeHtml(item.period)}</span>` : ''}
              </div>
            </div>`
          }

          const hasHeader = Boolean(item.title || item.period || item.subtitle)
          const headerHtml = hasHeader
            ? `<div class="item-header">
                <div class="item-left">
                  ${item.title ? `<span class="item-title">${escapeHtml(item.title)}</span>` : ''}
                  ${item.subtitle ? `<span class="item-inline-sub">${escapeHtml(item.subtitle)}</span>` : ''}
                </div>
                ${item.period ? `<span class="item-period">${escapeHtml(item.period)}</span>` : ''}
              </div>`
            : ''

          const linesHtml =
            item.lines.length > 0
              ? `<div class="item-lines">${item.lines
                  .map(
                    (l) =>
                      `<div class="line">${l.label ? `<span class="line-label">${escapeHtml(l.label)}：</span>` : ''}<span class="line-text">${escapeHtml(l.text)}</span></div>`
                  )
                  .join('')}</div>`
              : ''

          return `<div class="item">${headerHtml}${linesHtml}</div>`
        })
        .join('')

      return `<div class="section"><div class="section-title">${escapeHtml(sec.label)}</div>${itemsHtml}</div>`
    })
    .join('')

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(model.title || model.name + ' - 个人简历')}</title>
  <style>
    @page {
      size: A4;
      margin: ${dv.pageMargin};
    }
    * {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      padding: 0;
      font-family: ${tv.fontFamily};
      color: #1f2937;
      background-color: #eef2f6;
      font-size: ${dv.bodyFontSize};
      line-height: ${dv.bodyLineHeight};
      -webkit-font-smoothing: antialiased;
    }
    .page {
      background: #ffffff;
      width: 100%;
      max-width: 210mm;
      min-height: 297mm;
      margin: 20px auto;
      padding: ${dv.pagePadding};
      box-shadow: 0 3px 14px rgba(0, 0, 0, 0.08);
    }
    @media print {
      body {
        background: transparent;
      }
      .page {
        margin: 0;
        padding: 0;
        max-width: none;
        min-height: auto;
        box-shadow: none;
      }
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      padding-bottom: 4px;
    }
    .header-main {
      flex: 1;
    }
    .name-row {
      display: flex;
      align-items: baseline;
      gap: 12px;
      margin-bottom: 4px;
    }
    .name {
      font-size: ${dv.nameFontSize};
      font-weight: 700;
      color: ${tv.titleColor};
      letter-spacing: 0.5px;
      line-height: 1.2;
    }
    .resume-title {
      font-size: 14px;
      color: #4b5563;
      font-weight: 500;
    }
    .meta-line {
      font-size: ${dv.metaFontSize};
      color: #374151;
      line-height: ${dv.metaLineHeight};
      word-break: break-word;
    }
    .meta-sep {
      color: #9ca3af;
      margin: 0 4px;
    }
    .header-photo {
      flex-shrink: 0;
      width: ${dv.photoWidth};
      height: ${dv.photoHeight};
      overflow: hidden;
      border: 1px solid #d1d5db;
      background: #fafafa;
    }
    .header-photo img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      display: block;
    }
    .section {
      margin-top: ${dv.sectionMarginTop};
    }
    .section-title {
      font-size: ${dv.sectionTitleSize};
      font-weight: 700;
      color: ${tv.accent};
      border-bottom: ${tv.borderRule};
      padding-bottom: 2px;
      margin-bottom: ${dv.sectionTitleMarginBottom};
      letter-spacing: 0.5px;
    }
    .summary-text {
      font-size: ${dv.lineFontSize};
      color: #27272a;
      line-height: ${dv.lineHeight};
      white-space: pre-wrap;
      word-break: break-word;
    }
    .item {
      break-inside: avoid;
      page-break-inside: avoid;
      margin-bottom: ${dv.itemMarginBottom};
    }
    .item-compact {
      margin-bottom: ${dv.itemCompactMarginBottom};
    }
    .item-header {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 10px;
    }
    .item-left {
      display: flex;
      flex-wrap: wrap;
      align-items: baseline;
      gap: 8px;
    }
    .item-title {
      font-weight: 700;
      font-size: ${dv.itemTitleSize};
      color: #111827;
    }
    .item-inline-sub {
      font-size: ${dv.itemSubSize};
      color: #4b5563;
      font-weight: 500;
    }
    .item-period {
      font-size: ${dv.itemSubSize};
      color: #4b5563;
      white-space: nowrap;
      flex-shrink: 0;
    }
    .item-lines {
      margin-top: 2px;
    }
    .line {
      font-size: ${dv.lineFontSize};
      line-height: ${dv.lineHeight};
      color: #27272a;
      margin-bottom: ${dv.lineMarginBottom};
    }
    .line-label {
      font-weight: 600;
      color: #1f2937;
    }
    .line-text {
      white-space: pre-wrap;
      word-break: break-word;
    }
  </style>
</head>
<body>
  <div class="page">
    <div class="header">
      <div class="header-main">
        <div class="name-row">
          <span class="name">${escapeHtml(model.name)}</span>
          ${model.title ? `<span class="resume-title">${escapeHtml(model.title)}</span>` : ''}
        </div>
        ${metaHtml}
      </div>
      ${photoHtml}
    </div>
    ${summaryHtml}
    ${sectionsHtml}
  </div>
</body>
</html>`
}
