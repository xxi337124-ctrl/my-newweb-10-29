import { test, expect, describe } from 'bun:test'
import {
  ToolIndex,
  extractToolStarts,
  extractToolResults,
  serializeResult,
  parseToolResultImages,
  isToolResultError,
  SUBAGENT_TOOL_NAMES,
} from './tool-matching'
import type { ContentBlock, ToolUseBlock, ToolResultBlock } from './tool-matching'

// ============================================================================
// ToolIndex 测试
// ============================================================================

describe('ToolIndex', () => {
  test('注册和查询工具', () => {
    const index = new ToolIndex()
    index.register('tool-1', 'Read', { path: '/foo' })

    expect(index.has('tool-1')).toBe(true)
    expect(index.getName('tool-1')).toBe('Read')
    expect(index.getInput('tool-1')).toEqual({ path: '/foo' })
    expect(index.size).toBe(1)
  })

  test('不存在的工具返回 undefined', () => {
    const index = new ToolIndex()
    expect(index.has('nonexistent')).toBe(false)
    expect(index.getName('nonexistent')).toBeUndefined()
    expect(index.getInput('nonexistent')).toBeUndefined()
    expect(index.getEntry('nonexistent')).toBeUndefined()
  })

  test('幂等注册：相同 ID 不覆盖已有非空 input', () => {
    const index = new ToolIndex()
    index.register('tool-1', 'Read', { path: '/foo' })
    index.register('tool-1', 'Read', { path: '/bar' })

    // 第一次注册的 input 保留
    expect(index.getInput('tool-1')).toEqual({ path: '/foo' })
  })

  test('空 input 可被非空 input 覆盖', () => {
    const index = new ToolIndex()
    index.register('tool-1', 'Read', {})
    index.register('tool-1', 'Read', { path: '/foo' })

    expect(index.getInput('tool-1')).toEqual({ path: '/foo' })
  })

  test('多个工具独立存储', () => {
    const index = new ToolIndex()
    index.register('tool-1', 'Read', { path: '/a' })
    index.register('tool-2', 'Write', { path: '/b' })

    expect(index.size).toBe(2)
    expect(index.getName('tool-1')).toBe('Read')
    expect(index.getName('tool-2')).toBe('Write')
  })

  test('getEntry 返回完整条目', () => {
    const index = new ToolIndex()
    index.register('tool-1', 'Bash', { command: 'ls' })

    const entry = index.getEntry('tool-1')
    expect(entry).toEqual({ name: 'Bash', input: { command: 'ls' } })
  })
})

// ============================================================================
// SUBAGENT_TOOL_NAMES 测试
// ============================================================================

describe('SUBAGENT_TOOL_NAMES', () => {
  test('包含 Task 和 Agent', () => {
    expect(SUBAGENT_TOOL_NAMES.has('Task')).toBe(true)
    expect(SUBAGENT_TOOL_NAMES.has('Agent')).toBe(true)
  })

  test('不包含普通工具名', () => {
    expect(SUBAGENT_TOOL_NAMES.has('Read')).toBe(false)
    expect(SUBAGENT_TOOL_NAMES.has('Bash')).toBe(false)
  })
})

// ============================================================================
// serializeResult 测试
// ============================================================================

describe('serializeResult', () => {
  test('字符串直接返回', () => {
    expect(serializeResult('hello')).toBe('hello')
  })

  test('undefined 返回空字符串', () => {
    expect(serializeResult(undefined)).toBe('')
  })

  test('null 返回空字符串', () => {
    expect(serializeResult(null)).toBe('')
  })

  test('对象序列化为 JSON', () => {
    const result = serializeResult({ key: 'value' })
    expect(JSON.parse(result)).toEqual({ key: 'value' })
  })

  test('数组序列化为 JSON', () => {
    const result = serializeResult([1, 2, 3])
    expect(JSON.parse(result)).toEqual([1, 2, 3])
  })

  test('循环引用返回错误提示', () => {
    const obj: Record<string, unknown> = {}
    obj.self = obj
    expect(serializeResult(obj)).toBe('[结果包含不可序列化的数据]')
  })
})

// ============================================================================
// parseToolResultImages 测试
// ============================================================================

describe('parseToolResultImages', () => {
  test('无标记的文本原样返回', () => {
    const result = parseToolResultImages('普通文本结果')
    expect(result.text).toBe('普通文本结果')
    expect(result.images).toEqual([])
  })

  test('提取单个图片标记', () => {
    const raw = '结果文本 [XWOM_IMAGE_ATTACHMENT:{"localPath":"/tmp/img.png","filename":"img.png","mediaType":"image/png"}] 更多文本'
    const result = parseToolResultImages(raw)

    expect(result.images).toHaveLength(1)
    expect(result.images[0]).toEqual({
      localPath: '/tmp/img.png',
      filename: 'img.png',
      mediaType: 'image/png',
    })
    expect(result.text).toBe('结果文本  更多文本')
  })

  test('提取多个图片标记', () => {
    const raw = '[XWOM_IMAGE_ATTACHMENT:{"localPath":"/a.png","filename":"a.png","mediaType":"image/png"}] 中间 [XWOM_IMAGE_ATTACHMENT:{"localPath":"/b.jpg","filename":"b.jpg","mediaType":"image/jpeg"}]'
    const result = parseToolResultImages(raw)

    expect(result.images).toHaveLength(2)
    expect(result.images[0]?.localPath).toBe('/a.png')
    expect(result.images[1]?.localPath).toBe('/b.jpg')
  })

  test('无效 JSON 标记被忽略', () => {
    const raw = '[XWOM_IMAGE_ATTACHMENT:{invalid}] 文本'
    const result = parseToolResultImages(raw)

    expect(result.images).toHaveLength(0)
    expect(result.text).toBe('文本')
  })

  test('空字符串返回空结果', () => {
    const result = parseToolResultImages('')
    expect(result.text).toBe('')
    expect(result.images).toEqual([])
  })
})

// ============================================================================
// isToolResultError 测试
// ============================================================================

describe('isToolResultError', () => {
  test('以 "Error:" 开头的字符串返回 true', () => {
    expect(isToolResultError('Error: file not found')).toBe(true)
  })

  test('以 "error:" 开头的字符串返回 true', () => {
    expect(isToolResultError('error: permission denied')).toBe(true)
  })

  test('普通字符串返回 false', () => {
    expect(isToolResultError('success')).toBe(false)
    expect(isToolResultError('No errors found')).toBe(false)
  })

  test('包含 is_error 字段的对象', () => {
    expect(isToolResultError({ is_error: true })).toBe(true)
    expect(isToolResultError({ is_error: false })).toBe(false)
  })

  test('包含 error 字段的对象', () => {
    expect(isToolResultError({ error: 'something went wrong' })).toBe(true)
  })

  test('null / undefined 返回 false', () => {
    expect(isToolResultError(null)).toBe(false)
    expect(isToolResultError(undefined)).toBe(false)
  })

  test('普通对象返回 false', () => {
    expect(isToolResultError({ result: 'ok' })).toBe(false)
  })
})

// ============================================================================
// extractToolStarts 测试
// ============================================================================

describe('extractToolStarts', () => {
  test('从 assistant 消息提取 tool_use 块', () => {
    const toolIndex = new ToolIndex()
    const emitted = new Set<string>()
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'Let me read the file' },
      {
        type: 'tool_use',
        id: 'tu-1',
        name: 'Read',
        input: { path: '/foo.txt' },
      } as ToolUseBlock,
    ]

    const events = extractToolStarts(blocks, null, toolIndex, emitted)

    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('tool_start')
    expect(events[0]?.toolName).toBe('Read')
    expect(events[0]?.toolUseId).toBe('tu-1')
    // 工具应已注册
    expect(toolIndex.has('tu-1')).toBe(true)
    expect(emitted.has('tu-1')).toBe(true)
  })

  test('去重：相同 ID 不重复发出（无新 input）', () => {
    const toolIndex = new ToolIndex()
    const emitted = new Set<string>(['tu-1'])
    toolIndex.register('tu-1', 'Read', { path: '/foo.txt' })

    const blocks: ContentBlock[] = [
      {
        type: 'tool_use',
        id: 'tu-1',
        name: 'Read',
        input: {},  // 无新 input
      } as ToolUseBlock,
    ]

    const events = extractToolStarts(blocks, null, toolIndex, emitted)
    expect(events).toHaveLength(0)
  })

  test('去重但有新 input 时仍发出事件', () => {
    const toolIndex = new ToolIndex()
    const emitted = new Set<string>(['tu-1'])
    toolIndex.register('tu-1', 'Read', {})

    const blocks: ContentBlock[] = [
      {
        type: 'tool_use',
        id: 'tu-1',
        name: 'Read',
        input: { path: '/updated.txt' },
      } as ToolUseBlock,
    ]

    const events = extractToolStarts(blocks, null, toolIndex, emitted)
    expect(events).toHaveLength(1)
    expect(events[0]?.input).toEqual({ path: '/updated.txt' })
  })

  test('设置了 sdkParentToolUseId 时传递父级', () => {
    const toolIndex = new ToolIndex()
    const emitted = new Set<string>()
    const blocks: ContentBlock[] = [
      {
        type: 'tool_use',
        id: 'tu-child',
        name: 'Bash',
        input: { command: 'ls' },
      } as ToolUseBlock,
    ]

    const events = extractToolStarts(blocks, 'tu-parent', toolIndex, emitted)
    expect(events[0]?.parentToolUseId).toBe('tu-parent')
  })

  test('提取 _intent 和 _displayName', () => {
    const toolIndex = new ToolIndex()
    const emitted = new Set<string>()
    const blocks: ContentBlock[] = [
      {
        type: 'tool_use',
        id: 'tu-1',
        name: 'Bash',
        input: {
          command: 'npm test',
          _intent: '运行测试',
          _displayName: '执行测试套件',
          description: '备用描述',
        },
      } as ToolUseBlock,
    ]

    const events = extractToolStarts(blocks, null, toolIndex, emitted)
    expect(events[0]?.intent).toBe('运行测试')
    expect(events[0]?.displayName).toBe('执行测试套件')
  })

  test('Bash 工具无 _intent 时回退到 description', () => {
    const toolIndex = new ToolIndex()
    const emitted = new Set<string>()
    const blocks: ContentBlock[] = [
      {
        type: 'tool_use',
        id: 'tu-1',
        name: 'Bash',
        input: {
          command: 'npm test',
          description: '运行测试',
        },
      } as ToolUseBlock,
    ]

    const events = extractToolStarts(blocks, null, toolIndex, emitted)
    expect(events[0]?.intent).toBe('运行测试')
  })

  test('忽略非 tool_use 类型的块', () => {
    const toolIndex = new ToolIndex()
    const emitted = new Set<string>()
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'hello' },
      { type: 'image' },
    ]

    const events = extractToolStarts(blocks, null, toolIndex, emitted)
    expect(events).toHaveLength(0)
  })
})

// ============================================================================
// extractToolResults 测试
// ============================================================================

describe('extractToolResults', () => {
  test('从 tool_result 块提取结果事件', () => {
    const toolIndex = new ToolIndex()
    toolIndex.register('tu-1', 'Read', { path: '/foo.txt' })

    const blocks: ContentBlock[] = [
      {
        type: 'tool_result',
        tool_use_id: 'tu-1',
        content: '文件内容',
      } as ToolResultBlock,
    ]

    const events = extractToolResults(blocks, null, undefined, toolIndex)

    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('tool_result')
    expect(events[0]?.toolUseId).toBe('tu-1')
    expect(events[0]?.toolName).toBe('Read')
    expect(events[0]?.result).toBe('文件内容')
    expect(events[0]?.isError).toBe(false)
  })

  test('检测错误结果', () => {
    const toolIndex = new ToolIndex()
    toolIndex.register('tu-1', 'Read', { path: '/missing' })

    const blocks: ContentBlock[] = [
      {
        type: 'tool_result',
        tool_use_id: 'tu-1',
        content: 'Error: file not found',
        is_error: true,
      } as ToolResultBlock,
    ]

    const events = extractToolResults(blocks, null, undefined, toolIndex)
    expect(events[0]?.isError).toBe(true)
  })

  test('使用 toolUseResultValue 回退', () => {
    const toolIndex = new ToolIndex()
    toolIndex.register('parent-1', 'Task', { description: 'test' })

    const blocks: ContentBlock[] = []  // 空块
    const events = extractToolResults(blocks, 'parent-1', '任务完成', toolIndex)

    expect(events).toHaveLength(1)
    expect(events[0]?.type).toBe('tool_result')
    expect(events[0]?.toolUseId).toBe('parent-1')
    expect(events[0]?.result).toBe('任务完成')
  })

  test('无 tool_result 块且无 fallback 值时返回空', () => {
    const toolIndex = new ToolIndex()
    const blocks: ContentBlock[] = [{ type: 'text', text: 'hello' }]

    const events = extractToolResults(blocks, null, undefined, toolIndex)
    expect(events).toHaveLength(0)
  })

  test('MCP 数组内容提取文本', () => {
    const toolIndex = new ToolIndex()
    toolIndex.register('tu-1', 'mcp-tool', {})

    const blocks: ContentBlock[] = [
      {
        type: 'tool_result',
        tool_use_id: 'tu-1',
        content: [
          { type: 'text', text: '第一段' },
          { type: 'text', text: '第二段' },
        ],
      } as unknown as ToolResultBlock,
    ]

    const events = extractToolResults(blocks, null, undefined, toolIndex)
    expect(events[0]?.result).toContain('第一段')
    expect(events[0]?.result).toContain('第二段')
  })

  test('后台 Task 检测', () => {
    const toolIndex = new ToolIndex()
    toolIndex.register('tu-task', 'Task', {
      description: '后台编译',
      run_in_background: true,
    })

    const blocks: ContentBlock[] = [
      {
        type: 'tool_result',
        tool_use_id: 'tu-task',
        content: 'Started background task. agentId: bg-agent-123',
      } as ToolResultBlock,
    ]

    const events = extractToolResults(blocks, null, undefined, toolIndex)

    // 第一个是 tool_result，第二个是 task_backgrounded
    const bgEvent = events.find((e) => e.type === 'task_backgrounded')
    expect(bgEvent).toBeDefined()
    expect(bgEvent?.taskId).toBe('bg-agent-123')
  })

  test('后台 Shell 检测', () => {
    const toolIndex = new ToolIndex()
    toolIndex.register('tu-bash', 'Bash', {
      command: 'npm run dev',
      _intent: '启动开发服务器',
    })

    const blocks: ContentBlock[] = [
      {
        type: 'tool_result',
        tool_use_id: 'tu-bash',
        content: 'Process started. shell_id: shell-abc-123',
      } as ToolResultBlock,
    ]

    const events = extractToolResults(blocks, null, undefined, toolIndex)

    const bgEvent = events.find((e) => e.type === 'shell_backgrounded')
    expect(bgEvent).toBeDefined()
    expect(bgEvent?.shellId).toBe('shell-abc-123')
  })

  test('KillShell 检测', () => {
    const toolIndex = new ToolIndex()
    toolIndex.register('tu-kill', 'KillShell', { shell_id: 'shell-abc-123' })

    const blocks: ContentBlock[] = [
      {
        type: 'tool_result',
        tool_use_id: 'tu-kill',
        content: 'Shell terminated.',
      } as ToolResultBlock,
    ]

    const events = extractToolResults(blocks, null, undefined, toolIndex)

    const killEvent = events.find((e) => e.type === 'shell_killed')
    expect(killEvent).toBeDefined()
    expect(killEvent?.shellId).toBe('shell-abc-123')
  })
})
