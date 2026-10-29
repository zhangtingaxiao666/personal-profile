import fs from 'fs'
import path from 'path'
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  ImageRun,
  Table,
  TableRow,
  TableCell,
  TabStopType,
  BorderStyle,
  WidthType,
  AlignmentType,
  TableBorders,
  convertMillimetersToTwip
} from 'docx'
import type { Database, ExportResumeOptions } from '@shared/types'
import { buildResumeModel } from './resumeModel'

export async function buildResumeDocx(
  db: Database,
  opts: ExportResumeOptions,
  absOf: (rel: string) => string
): Promise<Buffer> {
  const model = buildResumeModel(db, opts, absOf)
  const accentColor = model.theme === 'modern' ? '1F4E79' : '18181B'
  const fontName = model.theme === 'academic' ? 'SimSun' : 'Microsoft YaHei'
  const isCompact = model.density === 'compact'
  const isLoose = model.density === 'loose'

  const marginTopBottomMm = isCompact ? 10 : isLoose ? 18 : 14
  const marginLeftRightMm = isCompact ? 12 : isLoose ? 18 : 15
  const CONTENT_WIDTH_TWIP = convertMillimetersToTwip(210 - marginLeftRightMm * 2)
  const bodyElements: (Paragraph | Table)[] = []

  // 1. 照片读取
  let imageRun: ImageRun | undefined
  if (model.photoAbsPath) {
    try {
      if (fs.existsSync(model.photoAbsPath)) {
        const ext = path.extname(model.photoAbsPath).toLowerCase().replace('.', '')
        const imgType: 'png' | 'jpg' | 'gif' | 'bmp' =
          ext === 'jpeg' || ext === 'jpg'
            ? 'jpg'
            : ext === 'gif'
              ? 'gif'
              : ext === 'bmp'
                ? 'bmp'
                : 'png'
        const imgBuffer = fs.readFileSync(model.photoAbsPath)
        imageRun = new ImageRun({
          data: imgBuffer,
          transformation: {
            width: 82,
            height: 110
          },
          type: imgType
        })
      }
    } catch {
      // ignore
    }
  }

  // 2. 头部信息（姓名、标题、紧凑个人信息行）
  const leftParagraphs: Paragraph[] = []

  const nameRuns: TextRun[] = [
    new TextRun({
      text: model.name,
      bold: true,
      size: '18pt',
      color: accentColor
    })
  ]
  if (model.title) {
    nameRuns.push(
      new TextRun({
        text: `   ${model.title}`,
        size: '10.5pt',
        color: '4B5563'
      })
    )
  }
  leftParagraphs.push(
    new Paragraph({
      children: nameRuns,
      spacing: { before: 0, after: 50 }
    })
  )

  const allMeta = [
    ...model.contacts,
    ...model.infoPairs.map((p) => `${p.label}：${p.value}`)
  ]
  if (allMeta.length > 0) {
    leftParagraphs.push(
      new Paragraph({
        children: [
          new TextRun({
            text: allMeta.join('  ｜  '),
            color: '374151',
            size: '9.5pt'
          })
        ],
        spacing: { before: 0, after: 40 }
      })
    )
  }

  if (imageRun) {
    bodyElements.push(
      new Table({
        borders: TableBorders.NONE,
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: [
              new TableCell({
                width: { size: 82, type: WidthType.PERCENTAGE },
                margins: { top: 0, bottom: 0, left: 0, right: 100 },
                children: leftParagraphs
              }),
              new TableCell({
                width: { size: 18, type: WidthType.PERCENTAGE },
                margins: { top: 0, bottom: 0, left: 100, right: 0 },
                children: [
                  new Paragraph({
                    children: [imageRun],
                    alignment: AlignmentType.RIGHT
                  })
                ]
              })
            ]
          })
        ]
      })
    )
  } else {
    bodyElements.push(...leftParagraphs)
  }

  // 3. 个人总结
  if (model.summary) {
    bodyElements.push(
      new Paragraph({
        children: [
          new TextRun({
            text: '个人总结',
            bold: true,
            size: '11pt',
            color: accentColor
          })
        ],
        border: {
          bottom: {
            style: BorderStyle.SINGLE,
            size: 8,
            color: accentColor,
            space: 2
          }
        },
        spacing: { before: 120, after: 50 }
      })
    )
    for (const subLine of model.summary.split('\n')) {
      bodyElements.push(
        new Paragraph({
          children: [
            new TextRun({
              text: subLine,
              size: '9.5pt',
              color: '27272A'
            })
          ],
          spacing: { before: 15, after: 15 }
        })
      )
    }
  }

  // 4. 各分类小节
  for (const sec of model.sections) {
    bodyElements.push(
      new Paragraph({
        children: [
          new TextRun({
            text: sec.label,
            bold: true,
            size: '11pt',
            color: accentColor
          })
        ],
        border: {
          bottom: {
            style: BorderStyle.SINGLE,
            size: 8,
            color: accentColor,
            space: 2
          }
        },
        spacing: { before: 140, after: 60 }
      })
    )

    for (const item of sec.items) {
      if (item.title || item.subtitle || item.period) {
        const titleRuns: TextRun[] = []
        if (item.title) {
          titleRuns.push(
            new TextRun({
              text: item.title,
              bold: true,
              size: '10pt',
              color: '111827'
            })
          )
        }
        if (item.subtitle) {
          titleRuns.push(
            new TextRun({
              text: item.title ? `   ${item.subtitle}` : item.subtitle,
              size: '9.5pt',
              color: '4B5563'
            })
          )
        }
        if (item.period) {
          titleRuns.push(
            new TextRun({
              text: `\t${item.period}`,
              color: '4B5563',
              size: '9.5pt'
            })
          )
        }
        bodyElements.push(
          new Paragraph({
            children: titleRuns,
            tabStops: [
              {
                type: TabStopType.RIGHT,
                position: CONTENT_WIDTH_TWIP
              }
            ],
            spacing: { before: item.compactInline ? 30 : 60, after: 15 }
          })
        )
      }

      for (const line of item.lines) {
        const subLines = line.text.split('\n')
        for (let i = 0; i < subLines.length; i++) {
          const sub = subLines[i]
          const runs: TextRun[] = []
          if (i === 0 && line.label) {
            runs.push(
              new TextRun({
                text: `${line.label}：`,
                bold: true,
                size: '9.5pt',
                color: '1F2937'
              })
            )
          }
          runs.push(
            new TextRun({
              text: sub,
              size: '9.5pt',
              color: '27272A'
            })
          )
          bodyElements.push(
            new Paragraph({
              children: runs,
              spacing: { before: 15, after: 15 }
            })
          )
        }
      }
    }
  }

  const doc = new Document({
    styles: {
      default: {
        document: {
          run: {
            font: {
              name: fontName,
              ascii: fontName,
              hAnsi: fontName,
              eastAsia: fontName,
              cs: fontName
            },
            size: '10pt',
            color: '1F2937'
          }
        }
      }
    },
    sections: [
      {
        properties: {
          page: {
            size: {
              width: convertMillimetersToTwip(210),
              height: convertMillimetersToTwip(297)
            },
            margin: {
              top: convertMillimetersToTwip(marginTopBottomMm),
              bottom: convertMillimetersToTwip(marginTopBottomMm),
              left: convertMillimetersToTwip(marginLeftRightMm),
              right: convertMillimetersToTwip(marginLeftRightMm)
            }
          }
        },
        children: bodyElements
      }
    ]
  })

  return await Packer.toBuffer(doc)
}
