import fs from 'fs'
import path from 'path'
import os from 'os'
import { describe, expect, it, vi } from 'vitest'
import AdmZip from 'adm-zip'
import { Document, Packer, Paragraph, Table, TableCell, TableRow, TextRun } from 'docx'
import type { Database, ExportResumeOptions } from '@shared/types'
import { buildResumeModel } from '../src/main/services/export/resumeModel'
import { buildResumeHtml } from '../src/main/services/export/resumeHtml'
import { buildResumeDocx } from '../src/main/services/export/docx'
import { createBackup, exportProofsZip, restoreBackup } from '../src/main/services/export/backup'
import { extractDocxText } from '../src/main/services/parse'
import { analyzeDocForFill, extractDocStructure, saveDocFillAnswers, writeFilledDoc } from '../src/main/services/docfill'
import { Store } from '../src/main/services/store'

const sampleDb: Database = {
  version: 1,
  profile: {
    data: {
      name: '张三',
      phone: '13800000000',
      idNumber: '110101200001011234',
      summary: '热爱编程',
      gender: '男',
      birth: '2000-01-01'
    },
    attachments: []
  },
  entries: [
    {
      id: 'e1',
      category: 'project',
      data: {
        name: '校园二手平台',
        role: '后端',
        start: '2023-03',
        end: '2023-09',
        techStack: ['Spring Boot', 'MySQL'],
        achievements: '用户 2000+'
      },
      tags: [],
      attachments: [],
      source: 'manual',
      order: 1,
      createdAt: '',
      updatedAt: ''
    },
    {
      id: 'e2',
      category: 'project',
      data: {
        name: '智能客服系统',
        role: '全栈',
        start: '2023-10',
        end: '2024-02',
        techStack: ['React', 'Node.js'],
        achievements: '满意度 98%'
      },
      tags: [],
      attachments: [],
      source: 'manual',
      order: 0,
      createdAt: '',
      updatedAt: ''
    },
    {
      id: 'e3',
      category: 'award',
      data: {
        name: '国家奖学金',
        level: '国家级',
        rank: '一等奖',
        date: '2023-11'
      },
      tags: [],
      attachments: [],
      source: 'manual',
      order: 0,
      createdAt: '',
      updatedAt: ''
    },
    {
      id: 'e4',
      category: 'skill',
      data: {
        name: 'Java',
        category: '编程语言',
        level: '熟练'
      },
      tags: [],
      attachments: [],
      source: 'manual',
      order: 0,
      createdAt: '',
      updatedAt: ''
    },
    {
      id: 'e5',
      category: 'skill',
      data: {
        name: 'Python',
        category: '编程语言',
        level: '熟悉'
      },
      tags: [],
      attachments: [],
      source: 'manual',
      order: 1,
      createdAt: '',
      updatedAt: ''
    }
  ],
  snippets: [],
  schema: { categories: {}, customCategories: [] }
}

const dummyAbsOf = (rel: string) => path.join('D:/data', rel)

describe('buildResumeModel', () => {
  it('分类筛选：只包含 opts.categories 中的未隐藏分类，没有条目的分类不输出', () => {
    const opts: ExportResumeOptions = {
      categories: ['project']
    }
    const model = buildResumeModel(sampleDb, opts, dummyAbsOf)
    expect(model.sections).toHaveLength(1)
    expect(model.sections[0].id).toBe('project')
    expect(model.sections[0].items).toHaveLength(2)
  })

  it('entryIds 筛选：opts.entryIds 有值时只包含这些条目', () => {
    const opts: ExportResumeOptions = {
      categories: ['project'],
      entryIds: ['e1']
    }
    const model = buildResumeModel(sampleDb, opts, dummyAbsOf)
    expect(model.sections[0].items).toHaveLength(1)
    expect(model.sections[0].items[0].title).toBe('校园二手平台')
  })

  it('sensitive 字段（profile 中 idNumber 的值）不出现', () => {
    const opts: ExportResumeOptions = {
      categories: ['project', 'award', 'skill']
    }
    const model = buildResumeModel(sampleDb, opts, dummyAbsOf)
    const json = JSON.stringify(model)
    expect(json).not.toContain('110101200001011234')
    expect(json).not.toContain('idNumber')
  })

  it('条目排序：按 order 升序排序', () => {
    const opts: ExportResumeOptions = {
      categories: ['project']
    }
    const model = buildResumeModel(sampleDb, opts, dummyAbsOf)
    const items = model.sections[0].items
    expect(items[0].title).toBe('智能客服系统') // order 0
    expect(items[1].title).toBe('校园二手平台') // order 1
  })

  it('技能分类特殊处理：所有技能合并为单个 item，按类别分组', () => {
    const opts: ExportResumeOptions = {
      categories: ['skill']
    }
    const model = buildResumeModel(sampleDb, opts, dummyAbsOf)
    expect(model.sections).toHaveLength(1)
    expect(model.sections[0].items).toHaveLength(1)
    const skillItem = model.sections[0].items[0]
    expect(skillItem.lines.length).toBeGreaterThan(0)
    expect(skillItem.lines[0].text).toContain('Java（熟练）')
  })
})

describe('buildResumeHtml', () => {
  it('包含姓名、不包含身份证号', () => {
    const opts: ExportResumeOptions = {
      categories: ['project', 'award']
    }
    const html = buildResumeHtml(sampleDb, opts, dummyAbsOf)
    expect(html).toContain('张三')
    expect(html).not.toContain('110101200001011234')
  })

  it('HTML 转义生效（输入 <script> 不会原样出现）', () => {
    const dbWithXss: Database = {
      ...sampleDb,
      profile: {
        ...sampleDb.profile,
        data: {
          ...sampleDb.profile.data,
          name: '<script>alert(1)</script>'
        }
      }
    }
    const opts: ExportResumeOptions = {
      categories: ['project']
    }
    const html = buildResumeHtml(dbWithXss, opts, dummyAbsOf)
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })
})

describe('buildResumeDocx', () => {
  it('返回非空 Buffer，用 adm-zip 打开后 word/document.xml 中包含姓名和某个项目名', async () => {
    const opts: ExportResumeOptions = {
      categories: ['project', 'award']
    }
    const buf = await buildResumeDocx(sampleDb, opts, dummyAbsOf)
    expect(Buffer.isBuffer(buf)).toBe(true)
    expect(buf.length).toBeGreaterThan(0)

    const zip = new AdmZip(buf)
    const docXml = zip.readAsText('word/document.xml')
    expect(docXml).toContain('张三')
    expect(docXml).toContain('校园二手平台')

    const tmpDocx = path.join(os.tmpdir(), `test-resume-${Date.now()}.docx`)
    fs.writeFileSync(tmpDocx, buf)
    const parsedText = await extractDocxText(tmpDocx)
    fs.rmSync(tmpDocx, { force: true })
    expect(parsedText).toContain('张三')
    expect(parsedText).toContain('校园二手平台')
  })
})

describe('backup & restore', () => {
  it('打包与恢复备份：db.json 内容与附件一致、snapshots 不在 zip 中、伪造无 manifest 的 zip 报错', () => {
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-test-'))
    const dataDir = path.join(testDir, 'data')
    const outZip = path.join(testDir, 'backup.zip')
    const restoreDir = path.join(testDir, 'restored')

    // 准备源数据
    fs.mkdirSync(path.join(dataDir, 'attachments', 'x'), { recursive: true })
    fs.mkdirSync(path.join(dataDir, 'snapshots'), { recursive: true })
    fs.writeFileSync(path.join(dataDir, 'db.json'), JSON.stringify(sampleDb, null, 2), 'utf-8')
    fs.writeFileSync(path.join(dataDir, 'attachments', 'x', 'a.txt'), 'attachment-content-123', 'utf-8')
    fs.writeFileSync(path.join(dataDir, 'snapshots', 's.json'), '{"snap":true}', 'utf-8')

    // 1. 创建备份
    createBackup(dataDir, outZip)
    expect(fs.existsSync(outZip)).toBe(true)

    // 验证 zip 内容：没有 snapshots
    const zip = new AdmZip(outZip)
    const entryNames = zip.getEntries().map((e) => e.entryName)
    expect(entryNames).toContain('manifest.json')
    expect(entryNames).toContain('db.json')
    expect(entryNames.some((n) => n.startsWith('attachments/'))).toBe(true)
    expect(entryNames.some((n) => n.startsWith('snapshots/'))).toBe(false)

    // 2. 恢复备份到新目录
    restoreBackup(outZip, restoreDir)
    expect(fs.existsSync(path.join(restoreDir, 'db.json'))).toBe(true)
    expect(fs.existsSync(path.join(restoreDir, 'attachments', 'x', 'a.txt'))).toBe(true)
    expect(fs.existsSync(path.join(restoreDir, 'snapshots'))).toBe(false)

    const restoredDb = JSON.parse(fs.readFileSync(path.join(restoreDir, 'db.json'), 'utf-8'))
    expect(restoredDb.profile.data.name).toBe('张三')
    const restoredAttach = fs.readFileSync(path.join(restoreDir, 'attachments', 'x', 'a.txt'), 'utf-8')
    expect(restoredAttach).toBe('attachment-content-123')

    // 3. 伪造无 manifest 的 zip 恢复时报错
    const fakeZipPath = path.join(testDir, 'fake.zip')
    const fakeZip = new AdmZip()
    fakeZip.addFile('db.json', Buffer.from(JSON.stringify(sampleDb), 'utf-8'))
    fakeZip.writeZip(fakeZipPath)

    expect(() => restoreBackup(fakeZipPath, restoreDir)).toThrow('不是有效的个人画像备份文件')

    // 清理临时文件
    try {
      fs.rmSync(testDir, { recursive: true, force: true })
    } catch {
      // ignore
    }
  })

  it('exportProofsZip：按规范重命名打包证明材料并生成目录清单', () => {
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'proofs-test-'))
    const attachDir = path.join(testDir, 'attachments', 'e3')
    fs.mkdirSync(attachDir, { recursive: true })
    const certPath = path.join(attachDir, 'raw_scan_001.pdf')
    fs.writeFileSync(certPath, 'fake-pdf-content', 'utf-8')

    const dbWithProof: Database = {
      ...sampleDb,
      entries: sampleDb.entries.map((e) =>
        e.id === 'e3'
          ? {
              ...e,
              attachments: [
                {
                  id: 'att1',
                  fileName: 'raw_scan_001.pdf',
                  relPath: 'attachments/e3/raw_scan_001.pdf',
                  mime: 'application/pdf',
                  size: 16,
                  addedAt: '2026-01-01'
                }
              ]
            }
          : e
      )
    }

    const outZip = path.join(testDir, 'proofs.zip')
    exportProofsZip(
      dbWithProof,
      {
        entryIds: ['e3'],
        namingPattern: 'index_cat_title',
        includeIndexFile: true
      },
      (rel) => path.join(testDir, rel),
      outZip
    )

    expect(fs.existsSync(outZip)).toBe(true)
    const zip = new AdmZip(outZip)
    const names = zip.getEntries().map((e) => e.entryName)
    expect(names).toContain('00_证明材料目录清单.txt')
    expect(names.some((n) => n.startsWith('01_获奖荣誉_国家奖学金') && n.endsWith('.pdf'))).toBe(true)

    const indexText = zip.readAsText('00_证明材料目录清单.txt')
    expect(indexText).toContain('张三')
    expect(indexText).toContain('国家奖学金')

    fs.rmSync(testDir, { recursive: true, force: true })
  })
})

describe('智能文件填表 (docfill)：检索文献库、未知项追问并入库、原文件覆盖与新文件另存', () => {
  it('解析 .docx 报名表 -> 检索命中项自动填写，未知项标记 missing 追问 -> 保存回答至资料库 -> 支持另存同目录新文件或直接覆盖原文件', async () => {
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docfill-test-'))
    const storeDir = path.join(testDir, 'store')
    const store = new Store(storeDir)
    store.saveProfile({ name: '张三', phone: '13800000000' })
    store.upsertEntry({
      category: 'publication',
      data: {
        title: '基于大模型的智能档案整理方法研究',
        venue: '计算机学报',
        date: '2025-05'
      }
    })

    // 构造一份待填写的 .docx 申请表（含：姓名、学号[未知]、代表性论文）
    const formDoc = new Document({
      sections: [
        {
          children: [
            new Table({
              rows: [
                new TableRow({
                  children: [
                    new TableCell({ children: [new Paragraph({ children: [new TextRun('姓名')] })] }),
                    new TableCell({ children: [new Paragraph('')] })
                  ]
                }),
                new TableRow({
                  children: [
                    new TableCell({ children: [new Paragraph({ children: [new TextRun('学号')] })] }),
                    new TableCell({ children: [new Paragraph('')] })
                  ]
                }),
                new TableRow({
                  children: [
                    new TableCell({ children: [new Paragraph({ children: [new TextRun('代表性论文')] })] }),
                    new TableCell({ children: [new Paragraph('')] })
                  ]
                })
              ]
            })
          ]
        }
      ]
    })

    const formPath = path.join(testDir, '夏令营申请表.docx')
    fs.writeFileSync(formPath, await Packer.toBuffer(formDoc))

    // 1. 验证结构解析
    const struct = extractDocStructure(formPath)
    expect(struct.kind).toBe('docx')
    expect(struct.slotMap.has('tc:0:0:1')).toBe(true)
    expect(struct.slotMap.has('tc:0:1:1')).toBe(true)
    expect(struct.slotMap.has('tc:0:2:1')).toBe(true)

    // 2. 模拟 AI 检索响应：姓名与代表性论文命中，学号未知（status: missing，绝不胡编）
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  slots: [
                    {
                      slotId: 'tc:0:0:1',
                      label: '姓名',
                      status: 'filled',
                      value: '张三',
                      source: '基本信息-姓名'
                    },
                    {
                      slotId: 'tc:0:1:1',
                      label: '学号',
                      status: 'missing',
                      value: '',
                      question: '资料库中未找到您的「学号」，请问您的学号是多少？',
                      saveKey: '学号',
                      saveKind: 'profile'
                    },
                    {
                      slotId: 'tc:0:2:1',
                      label: '代表性论文',
                      status: 'filled',
                      value: '《基于大模型的智能档案整理方法研究》，发表于《计算机学报》，2025-05',
                      source: '论文发表'
                    }
                  ]
                })
              }
            }
          ]
        })
      })
    )

    const analysis = await analyzeDocForFill(
      { baseURL: 'https://api.example.com/v1', model: 'test-model', apiKey: 'sk-test' },
      formPath,
      store.getDb(),
      (rel) => store.abs(rel)
    )

    expect(analysis.defaultNewPath).toBe(path.join(testDir, '夏令营申请表_已填写.docx'))
    expect(analysis.slots).toHaveLength(3)
    const missingSlot = analysis.slots.find((s) => s.label === '学号')!
    expect(missingSlot.status).toBe('missing')
    expect(missingSlot.value).toBe('')
    expect(missingSlot.question).toContain('学号')

    // 3. 用户回答“学号”后，系统自动记录到资料库供后续复用
    saveDocFillAnswers(store, [
      {
        slotId: 'tc:0:1:1',
        label: '学号',
        answer: '2022010888',
        saveKey: '学号',
        saveKind: 'profile'
      }
    ])
    const updatedDb = store.getDb()
    const extraFields = updatedDb.schema.categories.profile?.extraFields ?? []
    const studentIdField = extraFields.find((f) => f.label === '学号')
    expect(studentIdField).toBeDefined()
    expect(updatedDb.profile.data[studentIdField!.key]).toBe('2022010888')

    // 4. 方式一：另存为新文件（默认同一文件夹）
    const fillPayload = [
      { slotId: 'tc:0:0:1', value: '张三' },
      { slotId: 'tc:0:1:1', value: '2022010888' },
      { slotId: 'tc:0:2:1', value: '《基于大模型的智能档案整理方法研究》，发表于《计算机学报》，2025-05' }
    ]
    const newFileRes = writeFilledDoc({
      sourcePath: formPath,
      mode: 'newFile',
      slots: fillPayload
    })
    expect(newFileRes.outPath).toBe(path.join(testDir, '夏令营申请表_已填写.docx'))
    expect(fs.existsSync(newFileRes.outPath)).toBe(true)
    const newDocText = await extractDocxText(newFileRes.outPath)
    expect(newDocText).toContain('张三')
    expect(newDocText).toContain('2022010888')
    expect(newDocText).toContain('基于大模型的智能档案整理方法研究')

    // 原文件在 newFile 模式下保持未填状态
    const origTextBefore = await extractDocxText(formPath)
    expect(origTextBefore).not.toContain('2022010888')

    // 5. 方式二：直接在原文件上填写并覆盖保存
    const overwriteRes = writeFilledDoc({
      sourcePath: formPath,
      mode: 'overwrite',
      slots: fillPayload
    })
    expect(overwriteRes.outPath).toBe(formPath)
    const origTextAfter = await extractDocxText(formPath)
    expect(origTextAfter).toContain('张三')
    expect(origTextAfter).toContain('2022010888')
    expect(origTextAfter).toContain('基于大模型的智能档案整理方法研究')

    vi.unstubAllGlobals()
    fs.rmSync(testDir, { recursive: true, force: true })
  })

  it('Word 申请表「照片/证件照」单元格自动识别并嵌入个人证件照图片 (<w:drawing>)', async () => {
    const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'docfill-photo-test-'))
    const storeDir = path.join(testDir, 'store')
    const store = new Store(storeDir)
    store.saveProfile({ name: '张三' })

    // 准备一张 1x1 测试证件照并设置为个人头像
    const avatarPath = path.join(testDir, 'id_photo.png')
    fs.writeFileSync(
      avatarPath,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        'base64'
      )
    )
    const { relPath } = store.importFile(avatarPath, '_avatar')
    store.setAvatar(relPath)

    // 构造含「一寸免冠照片」单元格的 .docx 报名表
    const formDoc = new Document({
      sections: [
        {
          children: [
            new Table({
              rows: [
                new TableRow({
                  children: [
                    new TableCell({ children: [new Paragraph({ children: [new TextRun('姓名')] })] }),
                    new TableCell({ children: [new Paragraph('')] }),
                    new TableCell({ children: [new Paragraph({ children: [new TextRun('一寸免冠照片')] })] })
                  ]
                })
              ]
            })
          ]
        }
      ]
    })
    const formPath = path.join(testDir, '报名表_带照片.docx')
    fs.writeFileSync(formPath, await Packer.toBuffer(formDoc))

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  slots: [
                    { slotId: 'tc:0:0:1', label: '姓名', status: 'filled', value: '张三' }
                  ]
                })
              }
            }
          ]
        })
      })
    )

    const analysis = await analyzeDocForFill(
      { baseURL: 'https://api.example.com/v1', model: 'test-model', apiKey: 'sk-test' },
      formPath,
      store.getDb(),
      (rel) => store.abs(rel)
    )

    const photoSlot = analysis.slots.find((s) => s.isPhoto)
    expect(photoSlot).toBeDefined()
    expect(photoSlot!.slotId).toBe('tc:0:0:2')
    expect(photoSlot!.status).toBe('filled')

    const writeRes = writeFilledDoc(
      {
        sourcePath: formPath,
        mode: 'newFile',
        slots: analysis.slots.map((s) => ({ slotId: s.slotId, value: s.value }))
      },
      store.abs(store.getDb().profile.avatarRelPath!)
    )

    const outZip = new AdmZip(writeRes.outPath)
    expect(outZip.getEntry('word/media/personal_profile_avatar.png')).not.toBeNull()
    const outDocXml = outZip.readAsText('word/document.xml')
    expect(outDocXml).toContain('<w:drawing>')
    expect(outDocXml).toContain('rIdPersonalProfilePhoto99')

    vi.unstubAllGlobals()
    fs.rmSync(testDir, { recursive: true, force: true })
  })

  it('简历导出支持自定义模块顺序与一页纸紧凑模式 (density: compact)', () => {
    const modelReversed = buildResumeModel(
      sampleDb,
      {
        categories: ['award', 'skill', 'project'],
        density: 'compact'
      },
      dummyAbsOf
    )
    expect(modelReversed.sections.map((s) => s.id)).toEqual(['award', 'skill', 'project'])
    expect(modelReversed.density).toBe('compact')

    const htmlCompact = buildResumeHtml(
      sampleDb,
      {
        categories: ['award', 'skill', 'project'],
        density: 'compact'
      },
      dummyAbsOf
    )
    expect(htmlCompact).toContain('margin: 8mm 11mm')
  })
})
