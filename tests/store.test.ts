import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { Store, cleanData } from '../src/main/services/store'
import { resolveCategories, resolveProfileCategory, emptyOverrides, entryToParagraph, BUILTIN_CATEGORIES } from '../src/shared/categories'

let dir: string
let srcFile: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pp-store-'))
  srcFile = path.join(dir, '..', `cert-${Date.now()}.png`)
  fs.writeFileSync(srcFile, 'fakepng')
})

describe('Store', () => {
  it('增删改查并持久化', () => {
    const s = new Store(dir)
    const e = s.upsertEntry({ category: 'project', data: { name: '二手平台', role: '  后端 ', empty: '', techStack: ['A', ' ', 'B'] } })
    expect(e.data).toEqual({ name: '二手平台', role: '后端', techStack: ['A', 'B'] })
    s.upsertEntry({ id: e.id, category: 'project', data: { name: '二手平台 v2' } })
    const s2 = new Store(dir)
    expect(s2.getDb().entries[0].data.name).toBe('二手平台 v2')
    s2.deleteEntry(e.id)
    expect(new Store(dir).getDb().entries).toHaveLength(0)
  })

  it('order 自增与重排', () => {
    const s = new Store(dir)
    const a = s.upsertEntry({ category: 'award', data: { name: 'A' } })
    const b = s.upsertEntry({ category: 'award', data: { name: 'B' } })
    expect([a.order, b.order]).toEqual([0, 1])
    s.reorderEntries('award', [b.id, a.id])
    expect(s.getEntry(b.id)!.order).toBe(0)
  })

  it('附件复制、删除，删除条目时清理目录', () => {
    const s = new Store(dir)
    const e = s.upsertEntry({ category: 'award', data: { name: 'A' } })
    const [att] = s.addAttachments({ kind: 'entry', entryId: e.id }, [srcFile])
    expect(fs.existsSync(s.abs(att.relPath))).toBe(true)
    expect(att.mime).toBe('image/png')
    s.removeAttachment({ kind: 'entry', entryId: e.id }, att.id)
    expect(fs.existsSync(s.abs(att.relPath))).toBe(false)
    s.addAttachments({ kind: 'entry', entryId: e.id }, [srcFile])
    s.deleteEntry(e.id)
    expect(fs.existsSync(path.join(dir, 'attachments', e.id))).toBe(false)
  })

  it('拒绝越界路径', () => {
    const s = new Store(dir)
    expect(() => s.abs('../../etc/passwd')).toThrow()
  })

  it('原子写入：残留 tmp 文件不影响读取；主文件损坏时回退快照', () => {
    const s = new Store(dir)
    s.upsertEntry({ category: 'skill', data: { name: 'Java' } })
    s.snapshot()
    fs.writeFileSync(path.join(dir, 'db.json.tmp'), '{broken')
    expect(new Store(dir).getDb().entries).toHaveLength(1)
    fs.writeFileSync(path.join(dir, 'db.json'), '{broken')
    expect(new Store(dir).getDb().entries[0].data.name).toBe('Java')
  })

  it('commitCandidates：新建 / 合并，源文件作为附件，profilePatch 只填空字段', () => {
    const s = new Store(dir)
    s.saveProfile({ name: '张三' })
    const old = s.upsertEntry({ category: 'award', data: { name: '数学建模', level: '省部级' } })
    const res = s.commitCandidates(
      [
        { category: 'award', data: { rank: '一等奖' }, tags: ['竞赛'], sourceFiles: [srcFile], mergeInto: old.id },
        { category: 'certificate', data: { name: 'CET-6', score: '550' }, tags: [], sourceFiles: [srcFile] }
      ],
      { name: '李四', phone: '138' }
    )
    expect(res).toHaveLength(2)
    expect(res[0].id).toBe(old.id)
    expect(res[0].data).toMatchObject({ name: '数学建模', level: '省部级', rank: '一等奖' })
    expect(res[0].attachments).toHaveLength(1)
    expect(res[1].source).toBe('ai')
    const p = s.getDb().profile.data
    expect(p).toEqual({ name: '张三', phone: '138' })
  })

  it('cleanData 去空', () => {
    expect(cleanData({ a: '', b: [], c: null, d: 0, e: ' x ' })).toEqual({ d: 0, e: 'x' })
  })

  it('addAttachmentFromBase64：直接将剪贴板 base64 截图保存为证明文件', () => {
    const s = new Store(dir)
    const e = s.upsertEntry({ category: 'award', data: { name: '蓝桥杯' } })
    const pngBase64 =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    const att = s.addAttachmentFromBase64({ kind: 'entry', entryId: e.id }, pngBase64)
    expect(att.mime).toBe('image/png')
    expect(att.fileName.endsWith('.png')).toBe(true)
    expect(fs.existsSync(s.abs(att.relPath))).toBe(true)
    expect(s.getEntry(e.id)!.attachments).toHaveLength(1)
  })

  it('saveProfile 与 upsertEntry：部分字段保存时自动合并已有隐藏或扩展字段，不会丢失已有数据', () => {
    const s = new Store(dir)
    s.saveProfile({ name: '张三', c_advisor: '李老师', c_phone: '13800000001' })
    // 后续只传入部分字段（例如隐藏字段未挂载在表单上），原有扩展字段不会丢失
    s.saveProfile({ name: '张三', email: 'zhangsan@example.com' })
    expect(s.getDb().profile.data).toEqual({
      name: '张三',
      c_advisor: '李老师',
      c_phone: '13800000001',
      email: 'zhangsan@example.com'
    })

    const e = s.upsertEntry({
      category: 'education',
      data: { school: '示例大学', gpa: '3.78/4.0', c_weighted: '90.5' }
    })
    const updated = s.upsertEntry({
      id: e.id,
      category: 'education',
      data: { school: '示例大学', gpa: '3.82/4.0' }
    })
    expect(updated.data).toEqual({
      school: '示例大学',
      gpa: '3.82/4.0',
      c_weighted: '90.5'
    })
  })

  it('mergeEntries：一键无损合并两条重复或冲突条目（保留双方字段、标签与物理附件文件）', () => {
    const s = new Store(dir)
    const e1 = s.upsertEntry({
      category: 'education',
      data: { school: '示例大学', degree: '本科', gpa: '3.85/4.0' },
      tags: ['理工']
    })
    const e2 = s.upsertEntry({
      category: 'education',
      data: { school: '示例大学', degree: '本科', gpa: '91.5/100', rank: '5/100' },
      tags: ['计算机']
    })
    const pngBase64 =
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    s.addAttachmentFromBase64({ kind: 'entry', entryId: e2.id }, pngBase64, '成绩单.png')

    const merged = s.mergeEntries(e1.id, e2.id, { gpa: '3.85/4.0（百分制：91.5/100）' })
    expect(s.getDb().entries).toHaveLength(1)
    expect(merged.data.gpa).toBe('3.85/4.0（百分制：91.5/100）')
    expect(merged.data.rank).toBe('5/100')
    expect(merged.tags).toEqual(['理工', '计算机'])
    expect(merged.attachments).toHaveLength(1)
    expect(fs.existsSync(s.abs(merged.attachments[0].relPath))).toBe(true)
  })

  it('历史快照时光机：createSnapshotNow / listSnapshotMetas / restoreSnapshot', () => {
    const s = new Store(dir)
    s.saveProfile({ name: '张三' })
    s.upsertEntry({ category: 'education', data: { school: '示例大学' } })

    const snap = s.createSnapshotNow()
    expect(snap).not.toBeNull()
    expect(snap!.profileName).toBe('张三')
    expect(snap!.entryCount).toBe(1)

    const list = s.listSnapshotMetas()
    expect(list.length).toBeGreaterThanOrEqual(1)

    // 模拟误删条目后一键回滚到快照
    const entryId = s.getDb().entries[0].id
    s.deleteEntry(entryId)
    expect(s.getDb().entries).toHaveLength(0)

    s.restoreSnapshot(snap!.id)
    expect(s.getDb().entries).toHaveLength(1)
    expect(s.getDb().entries[0].data.school).toBe('示例大学')
  })
})

describe('schema 合并', () => {
  it('重命名 / 隐藏 / 新增字段 / 排序 / 自定义分类', () => {
    const ov = emptyOverrides()
    ov.categories.project = {
      label: '项目经历',
      fieldPatches: { role: { label: '我的角色' }, link: { hidden: true } },
      extraFields: [{ key: 'c_team', label: '团队规模', type: 'number' }],
      fieldOrder: ['c_team', 'name']
    }
    ov.categories.profile = { extraFields: [{ key: 'c_height', label: '身高', type: 'text' }] }
    ov.customCategories.push({ id: 'cc_1', label: '志愿服务', icon: 'HeartOutlined', titleField: 'name', fields: [{ key: 'name', label: '名称', type: 'text' }] })
    ov.categoryOrder = ['cc_1']

    const cats = resolveCategories(ov)
    expect(cats[0].id).toBe('cc_1')
    expect(cats[0].custom).toBe(true)
    const p = cats.find((c) => c.id === 'project')!
    expect(p.label).toBe('项目经历')
    expect(p.fields[0].key).toBe('c_team')
    expect(p.fields[1].key).toBe('name')
    expect(p.fields.find((f) => f.key === 'role')!.label).toBe('我的角色')
    expect(p.fields.find((f) => f.key === 'link')!.hidden).toBe(true)
    expect(resolveProfileCategory(ov).fields.some((f) => f.key === 'c_height')).toBe(true)
    // 内置定义不被修改
    expect(BUILTIN_CATEGORIES.find((c) => c.id === 'project')!.label).toBe('项目经验')
  })

  it('entryToParagraph 生成可粘贴文本', () => {
    const def = BUILTIN_CATEGORIES.find((c) => c.id === 'project')!
    const t = entryToParagraph(def, { name: '二手平台', role: '后端', start: '2023-03', end: '至今', techStack: ['Java', 'MySQL'] })
    expect(t).toContain('二手平台')
    expect(t).toContain('2023.03 - 至今')
    expect(t).toContain('技术/工具：Java、MySQL')
  })
})
