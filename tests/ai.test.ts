import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Database, Entry } from '@shared/types'
import type { ResolvedModel } from '../src/main/services/settings'
import { chat, chatStream, fetchModels, pickRecommendedModel, testConnection } from '../src/main/services/ai/client'
import {
  buildExtractionSystemPrompt,
  buildGeneratePrompt,
  buildProfileContext,
  buildSchemaDescription
} from '../src/main/services/ai/prompts'
import {
  extractFromInputs,
  findDuplicate,
  normalizeResult,
  organizeText,
  parseModelJson
} from '../src/main/services/ai/extract'
import { batchFillForm, deAiResumePreview, polishFieldText } from '../src/main/services/ai/generate'
import {
  analyzeGradeConflict,
  detectEntryConflicts,
  findDuplicateEntry,
  scanDatabaseConflicts
} from '../src/shared/diagnostics'
import { BUILTIN_CATEGORIES } from '../src/shared/categories'

const mockModel: ResolvedModel = {
  baseURL: 'https://api.example.com/v1',
  model: 'test-model',
  apiKey: 'sk-test-key'
}

function createTestDb(entries: Entry[] = []): Database {
  return {
    version: 1,
    profile: {
      data: {
        name: '张三',
        idNumber: '110101200001011234',
        gender: '男',
        phone: '13800000000'
      },
      attachments: []
    },
    entries,
    snippets: [],
    schema: { categories: {}, customCategories: [] }
  }
}

describe('AI 模块测试', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('parseModelJson', () => {
    it('处理代码块包裹', () => {
      const input = '```json\n{"profile": {"name": "张三"}}\n```'
      const res = parseModelJson(input) as { profile: { name: string } }
      expect(res.profile.name).toBe('张三')
    })

    it('处理前后有说明文字', () => {
      const input = '这里是提取出来的 JSON 数据：\n```json\n{"entries": []}\n```\n请检查是否有遗漏。'
      const res = parseModelJson(input) as { entries: unknown[] }
      expect(res.entries).toEqual([])
    })

    it('处理尾随逗号', () => {
      const input = `
        {
          "profile": {
            "name": "李四",
          },
          "entries": [
            {
              "category": "education",
              "data": { "school": "北大", },
              "tags": ["理学", "AI",],
            },
          ],
          "warnings": [
            "存疑说明",
          ],
        }
      `
      const res = parseModelJson(input) as any
      expect(res.profile.name).toBe('李四')
      expect(res.entries[0].data.school).toBe('北大')
      expect(res.entries[0].tags).toEqual(['理学', 'AI'])
      expect(res.warnings).toEqual(['存疑说明'])
    })
  })

  describe('normalizeResult', () => {
    const db = createTestDb()

    it('丢弃未知分类并添加 warning', () => {
      const raw = {
        entries: [
          { category: 'non_existent_category', data: { foo: 'bar' } }
        ]
      }
      const res = normalizeResult(raw, db)
      expect(res.candidates).toHaveLength(0)
      expect(res.warnings.length).toBeGreaterThan(0)
      expect(res.warnings[0]).toContain('non_existent_category')
    })

    it('规范化日期与月份（多种写法）', () => {
      const raw = {
        entries: [
          {
            category: 'education',
            data: {
              school: '清华大学',
              start: '2021.9',
              end: '至今'
            }
          },
          {
            category: 'education',
            data: {
              school: '北京大学',
              start: '2021/09',
              end: '现在'
            }
          },
          {
            category: 'education',
            data: {
              school: '复旦大学',
              start: '2021年9月',
              end: 'present'
            }
          },
          {
            category: 'education',
            data: {
              school: '上海交通大学',
              start: '2021-9',
              end: '2025-06'
            }
          }
        ],
        profile: {
          birth: '2000.1.5'
        }
      }

      const res = normalizeResult(raw, db)
      expect(res.candidates).toHaveLength(4)
      expect(res.candidates[0].data.start).toBe('2021-09')
      expect(res.candidates[0].data.end).toBe('至今')

      expect(res.candidates[1].data.start).toBe('2021-09')
      expect(res.candidates[1].data.end).toBe('至今')

      expect(res.candidates[2].data.start).toBe('2021-09')
      expect(res.candidates[2].data.end).toBe('至今')

      expect(res.candidates[3].data.start).toBe('2021-09')
      expect(res.candidates[3].data.end).toBe('2025-06')

      expect(res.profilePatch.birth).toBe('2000-01-05')
    })

    it('tags 字符串拆分', () => {
      const raw = {
        entries: [
          {
            category: 'education',
            data: {
              school: '浙江大学',
              courses: '微积分, 线性代数、 离散数学; 数据结构；算法分析'
            },
            tags: '计算机, 软件工程、 考研'
          }
        ]
      }
      const res = normalizeResult(raw, db)
      expect(res.candidates[0].data.courses).toEqual([
        '微积分',
        '线性代数',
        '离散数学',
        '数据结构',
        '算法分析'
      ])
      expect(res.candidates[0].tags).toEqual(['计算机', '软件工程', '考研'])
    })

    it('丢弃未知字段与空值', () => {
      const raw = {
        entries: [
          {
            category: 'education',
            data: {
              school: '南京大学',
              nonExistentKey: 'should_be_dropped',
              college: '  '
            }
          }
        ]
      }
      const res = normalizeResult(raw, db)
      expect(res.candidates[0].data.school).toBe('南京大学')
      expect(res.candidates[0].data.nonExistentKey).toBeUndefined()
      expect(res.candidates[0].data.college).toBeUndefined()
    })

    it('丢弃 sensitive 的 profile 字段（idNumber）', () => {
      const raw = {
        profile: {
          name: '李四',
          phone: '13912345678',
          idNumber: '110101199003072345',
          unknownField: 'test'
        }
      }
      const res = normalizeResult(raw, db)
      expect(res.profilePatch.name).toBe('李四')
      expect(res.profilePatch.phone).toBe('13912345678')
      expect(res.profilePatch.idNumber).toBeUndefined()
      expect(res.profilePatch.unknownField).toBeUndefined()
    })
  })

  describe('findDuplicate', () => {
    const existingEntries: Entry[] = [
      {
        id: 'edu-1',
        category: 'education',
        data: { school: '北京大学', degree: '本科' },
        tags: [],
        attachments: [],
        source: 'manual',
        order: 1,
        createdAt: '',
        updatedAt: ''
      },
      {
        id: 'work-1',
        category: 'work',
        data: { company: '阿里巴巴网络技术有限公司', position: '前端工程师' },
        tags: [],
        attachments: [],
        source: 'manual',
        order: 1,
        createdAt: '',
        updatedAt: ''
      }
    ]
    const db = createTestDb(existingEntries)

    it('标题相同或互相包含（长度>=4）时命中', () => {
      // 1. 完全相同（全角/半角、空格、大小写）
      const dup1 = findDuplicate(
        { category: 'education', data: { school: '  北京大学  ' } },
        db
      )
      expect(dup1).toBe('edu-1')

      // 2. 候选标题包含已有标题（已有标题 "北京大学" 长度为 4 >= 4）
      const dup2 = findDuplicate(
        { category: 'education', data: { school: '北京大学信息科学技术学院' } },
        db
      )
      expect(dup2).toBe('edu-1')

      // 3. 已有标题包含候选标题（"阿里巴巴" 长度为 4 >= 4）
      const dup3 = findDuplicate(
        { category: 'work', data: { company: '阿里巴巴' } },
        db
      )
      expect(dup3).toBe('work-1')

      // 4. 不同分类不匹配
      const noDupCat = findDuplicate(
        { category: 'project', data: { name: '北京大学' } },
        db
      )
      expect(noDupCat).toBeUndefined()

      // 5. 互相不包含或长度不足
      const noDupDiff = findDuplicate(
        { category: 'education', data: { school: '清华大学' } },
        db
      )
      expect(noDupDiff).toBeUndefined()
    })
  })

  describe('buildProfileContext', () => {
    it('结果中不包含身份证号的值', () => {
      const db = createTestDb([
        {
          id: 'edu-1',
          category: 'education',
          data: {
            school: '北京大学',
            degree: '本科',
            major: '计算机科学与技术',
            start: '2020-09',
            end: '2024-06'
          },
          tags: [],
          attachments: [],
          source: 'manual',
          order: 1,
          createdAt: '',
          updatedAt: ''
        }
      ])

      const context = buildProfileContext(db)
      expect(context).toContain('张三')
      expect(context).toContain('北京大学')
      expect(context).not.toContain('110101200001011234')
    })
  })

  describe('chat / chatStream', () => {
    it('模拟普通 JSON 响应', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: '模型返回的回答文本' } }]
          })
        })
      )

      const res = await chat(mockModel, [{ role: 'user', content: '你好' }])
      expect(res).toBe('模型返回的回答文本')
    })

    it('模拟 SSE 流（把一行切成两个 chunk）', async () => {
      const chunk1 = new TextEncoder().encode(
        'data: {"choices":[{"delta":{"content":"你好'
      )
      const chunk2 = new TextEncoder().encode(
        '，世界！"}}]}\n\ndata: [DONE]\n\n'
      )

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(chunk1)
          controller.enqueue(chunk2)
          controller.close()
        }
      })

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          body: stream
        })
      )

      const deltas: string[] = []
      const full = await chatStream(
        mockModel,
        [{ role: 'user', content: '测试流' }],
        (t) => deltas.push(t)
      )

      expect(full).toBe('你好，世界！')
      expect(deltas.join('')).toBe('你好，世界！')
    })

    it('模拟 401 响应得到中文错误', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 401,
          text: async () => JSON.stringify({ error: { message: 'Invalid API key' } })
        })
      )

      await expect(
        chat(mockModel, [{ role: 'user', content: '测试错误' }])
      ).rejects.toThrow('API Key 无效或无权限')
    })

    it('400 包含 response_format 时自动去掉该参数重试一次', async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: false,
          status: 400,
          text: async () => 'Unsupported parameter: response_format'
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: '{"status":"ok"}' } }]
          })
        })

      vi.stubGlobal('fetch', mockFetch)

      const res = await chat(mockModel, [{ role: 'user', content: 'json test' }], {
        json: true
      })
      expect(res).toBe('{"status":"ok"}')
      expect(mockFetch).toHaveBeenCalledTimes(2)

      const firstCallBody = JSON.parse(mockFetch.mock.calls[0][1].body)
      const secondCallBody = JSON.parse(mockFetch.mock.calls[1][1].body)
      expect(firstCallBody.response_format).toEqual({ type: 'json_object' })
      expect(secondCallBody.response_format).toBeUndefined()
    })

    it('testConnection 成功与失败（不抛出）', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            choices: [{ message: { content: 'OK' } }]
          })
        })
      )

      const success = await testConnection(mockModel, false)
      expect(success.ok).toBe(true)
      expect(success.message).toContain('连接成功')

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 403,
          text: async () => 'Forbidden'
        })
      )

      const fail = await testConnection(mockModel, true)
      expect(fail.ok).toBe(false)
      expect(fail.message).toContain('API Key 无效或无权限')
    })

    it('fetchModels & pickRecommendedModel：自动拉取 /models 并过滤非对话模型与智能推荐文本/视觉模型', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            data: [
              { id: 'text-embedding-3-small' },
              { id: 'deepseek-reasoner' },
              { id: 'deepseek-chat' },
              { id: 'deepseek-vl2' }
            ]
          })
        })
      )

      const models = await fetchModels('https://api.deepseek.com/v1/', 'sk-123')
      expect(models).toEqual(['deepseek-reasoner', 'deepseek-chat', 'deepseek-vl2'])
      expect(pickRecommendedModel(models, false)).toBe('deepseek-chat')
      expect(pickRecommendedModel(models, true)).toBe('deepseek-vl2')
    })
  })

  describe('extractFromInputs & organizeText', () => {
    const db = createTestDb()

    it('extractFromInputs：有 images 使用 vision 模型，部分失败记录 warnings，全部失败则抛出错误', async () => {
      const modelTypesCalled: string[] = []
      const getModel = (w: 'text' | 'vision') => {
        modelTypesCalled.push(w)
        return { ...mockModel, model: `${w}-model` }
      }

      // 1. 测试混合输入：一个纯文本成功，一个失败
      let callCount = 0
      vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => {
        callCount++
        if (callCount === 1) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              choices: [
                {
                  message: {
                    content: JSON.stringify({
                      profile: { name: '赵六' },
                      entries: [
                        { category: 'education', data: { school: '南京大学' } }
                      ],
                      warnings: ['文本存疑']
                    })
                  }
                }
              ]
            })
          }
        } else {
          return {
            ok: false,
            status: 500,
            text: async () => 'Internal Server Error'
          }
        }
      }))

      const mixedRes = await extractFromInputs(
        getModel,
        [
          { fileName: 'resume.txt', text: '经历内容' },
          { fileName: 'cert.png', images: ['data:image/png;base64,...'] }
        ],
        db
      )

      expect(modelTypesCalled).toEqual(['text', 'vision'])
      expect(mixedRes.candidates).toHaveLength(1)
      expect(mixedRes.candidates[0].data.school).toBe('南京大学')
      expect(mixedRes.candidates[0].tempId).toBeDefined()
      expect(mixedRes.profilePatch.name).toBe('赵六')
      // cert.png 报错写入 warnings，resume.txt 的 warning 带有文件名前缀
      expect(mixedRes.warnings).toEqual([
        'resume.txt：文本存疑',
        'cert.png：请求失败 (500)：Internal Server Error'
      ])

      // 2. 全部失败则抛出第一个错误
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized'
      }))

      await expect(
        extractFromInputs(
          getModel,
          [{ fileName: 'test.pdf', text: 'some content' }],
          db
        )
      ).rejects.toThrow('API Key 无效或无权限')
    })

    it('organizeText：成功整理口述文本为候选条目', async () => {
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
                    profile: {},
                    entries: [
                      {
                        category: 'project',
                        data: {
                          name: '个人博客系统',
                          role: '独立开发者',
                          responsibilities: '• 负责前后端开发与部署'
                        },
                        tags: ['Vue', 'Node.js']
                      }
                    ],
                    warnings: []
                  })
                }
              }
            ]
          })
        })
      )

      const res = await organizeText(
        mockModel,
        '我之前自己做了一个个人博客系统，独立开发的，用的 Vue 和 Node',
        'project',
        db
      )

      expect(res.candidates).toHaveLength(1)
      expect(res.candidates[0].category).toBe('project')
      expect(res.candidates[0].data.name).toBe('个人博客系统')
      expect(res.candidates[0].tempId).toBeDefined()
      expect(res.candidates[0].sourceFiles).toEqual([])
    })
  })

  describe('冲突与重复诊断引擎 (diagnostics)', () => {
    it('区分成绩计算方式/分制不同 vs 同分制不同学期成绩冲突', () => {
      // 1. 四分制 vs 百分制
      const scaleDiff = analyzeGradeConflict('gpa', 'GPA / 均分', '3.85/4.0', '91.5/100')
      expect(scaleDiff.hint).toContain('计算方式/分制不同')
      expect(scaleDiff.hint).toContain('四分制')
      expect(scaleDiff.hint).toContain('百分制')
      expect(scaleDiff.combinedValue).toBe('3.85/4.0（百分制：91.5/100）')

      // 2. 同为四分制，不同学期更新或加权算法不同
      const semDiff = analyzeGradeConflict('gpa', 'GPA / 均分', '3.72/4.0', '3.86/4.0')
      expect(semDiff.hint).toContain('不同学期/阶段的成绩单更新')
      expect(semDiff.hint).toContain('加权学分绩与算术平均绩点算法不同')
      expect(semDiff.combinedValue).toContain('3.86/4.0')
      expect(semDiff.combinedValue).toContain('3.72/4.0')
    })

    it('同一学校不同学历（本科 vs 硕士）不判定为重复，相同学历则判定重复并提取字段冲突', () => {
      const db = createTestDb([
        {
          id: 'edu-ug',
          category: 'education',
          data: { school: '清华大学', degree: '本科', gpa: '3.8/4.0', rank: '5/120' },
          tags: [],
          attachments: [],
          source: 'manual',
          order: 0,
          createdAt: '',
          updatedAt: ''
        }
      ])

      // 硕士在同校不视为重复
      const masterDup = findDuplicateEntry(
        { category: 'education', data: { school: '清华大学', degree: '硕士', gpa: '3.9/4.0' } },
        db
      )
      expect(masterDup).toBeUndefined()

      // 本科在同校视为重复，且 normalizeResult 会附带 conflicts
      const res = normalizeResult(
        {
          entries: [
            {
              category: 'education',
              data: { school: '清华大学', degree: '本科', gpa: '90.5/100', rank: '3/120' }
            }
          ]
        },
        db
      )
      expect(res.candidates).toHaveLength(1)
      expect(res.candidates[0].duplicateOf).toBe('edu-ug')
      expect(res.candidates[0].conflicts).toBeDefined()
      expect(res.candidates[0].conflicts?.map((c) => c.fieldKey)).toEqual(['gpa', 'rank'])
      expect(res.warnings.some((w) => w.includes('分制不同'))).toBe(true)
    })

    it('scanDatabaseConflicts 能扫描出库内已有的成绩冲突、重复条目与时间倒置', () => {
      const db = createTestDb([
        {
          id: 'e1',
          category: 'education',
          data: { school: '浙江大学', degree: '本科', gpa: '3.9/4.0', start: '2024-09', end: '2021-06' },
          tags: [],
          attachments: [],
          source: 'manual',
          order: 0,
          createdAt: '',
          updatedAt: ''
        },
        {
          id: 'e2',
          category: 'education',
          data: { school: '浙江大学', degree: '本科', gpa: '4.6/5.0' },
          tags: [],
          attachments: [],
          source: 'ai',
          order: 1,
          createdAt: '',
          updatedAt: ''
        }
      ])
      const warnings = scanDatabaseConflicts(db)
      expect(warnings.some((w) => w.kind === 'timeline')).toBe(true)
      expect(warnings.some((w) => w.kind === 'conflict' && w.detail.includes('五分制'))).toBe(true)

      const eduDef = BUILTIN_CATEGORIES.find((c) => c.id === 'education')!
      const conflicts = detectEntryConflicts({ category: 'education', data: db.entries[1].data }, db.entries[0], eduDef)
      expect(conflicts).toHaveLength(1)
      expect(conflicts[0].fieldKey).toBe('gpa')
    })
  })

  describe('batchFillForm & polishFieldText', () => {
    const db = createTestDb()

    it('batchFillForm：解析表格栏目并返回匹配值数组', async () => {
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
                    items: [
                      { field: '姓名', value: '张三', note: '来自基本信息' },
                      { field: '联系电话', value: '13800000000', note: '来自基本信息' }
                    ]
                  })
                }
              }
            ]
          })
        })
      )

      const items = await batchFillForm(
        () => mockModel,
        { fieldsText: '姓名\n联系电话' },
        db
      )
      expect(items).toHaveLength(2)
      expect(items[0]).toEqual({ field: '姓名', value: '张三', note: '来自基本信息' })
    })

    it('polishFieldText：润色多行经历文本并去除首尾引号', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  content: '• 主导核心后端接口研发，将响应耗时降低 40%'
                }
              }
            ]
          })
        })
      )

      const out = await polishFieldText(mockModel, {
        categoryLabel: '项目经验',
        fieldLabel: '主要职责',
        rawText: '写了后端接口，速度变快了40%'
      })
      expect(out).toBe('• 主导核心后端接口研发，将响应耗时降低 40%')
    })

    it('deAiResumePreview：扫描简历中的 AI 腔套话并生成平实化改写建议', async () => {
      const dbWithAiCliche = createTestDb([
        {
          id: 'p1',
          category: 'project',
          data: {
            name: '订单管理系统',
            responsibilities: '通过全方位赋能订单流转全链路闭环，深度沉淀高可用架构抓手'
          },
          tags: [],
          attachments: [],
          source: 'ai',
          order: 0,
          createdAt: '',
          updatedAt: ''
        }
      ])

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
                    patches: [
                      {
                        id: 'p1:responsibilities',
                        revised: '• 负责订单状态流转接口与异常处理模块的开发与维护'
                      }
                    ]
                  })
                }
              }
            ]
          })
        })
      )

      const patches = await deAiResumePreview(mockModel, dbWithAiCliche)
      expect(patches).toHaveLength(1)
      expect(patches[0].entryId).toBe('p1')
      expect(patches[0].revised).toBe('• 负责订单状态流转接口与异常处理模块的开发与维护')
    })

    it('buildGeneratePrompt：包含反八股排比规则，并支持对已生成文本提出修改意见 (refineFeedback)', () => {
      const msgsInitial = buildGeneratePrompt(
        {
          requirement: '请写一段200字自我介绍',
          wordLimit: 200,
          tone: 'formal'
        },
        db
      )
      expect(msgsInitial[0].content).toContain('严禁使用死板的“AI 八股文”分段公式')
      expect(msgsInitial[0].content).toContain('在学习/学业方面')

      const msgsRefine = buildGeneratePrompt(
        {
          requirement: '请写一段200字自我介绍',
          currentText: '在学习方面，我成绩优异；在科研方面，我积极探索；综上所述，我是一名优秀的学生。',
          refineFeedback: '去掉“在XX方面”的死板套路，改成自然口语叙述'
        },
        db
      )
      expect(msgsRefine[1].content).toContain('【当前已生成的文本草稿】')
      expect(msgsRefine[1].content).toContain('在学习方面，我成绩优异')
      expect(msgsRefine[1].content).toContain('【⚠️ 用户提出的修改意见（最高优先级，必须严格落实）】')
      expect(msgsRefine[1].content).toContain('去掉“在XX方面”的死板套路，改成自然口语叙述')
    })
  })
})
