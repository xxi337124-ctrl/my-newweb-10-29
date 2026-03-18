/**
 * chat-service.ts 纯逻辑单元测试
 *
 * 测试 filterHistory — 上下文过滤的三层逻辑：
 * 1. 过滤空内容助手消息
 * 2. 分隔线截断
 * 3. 轮数裁剪
 */

import { test, expect, describe } from 'bun:test'
import { filterHistory } from './chat-service-utils'
import type { ChatMessage } from '@xwom/shared'

// ============================================================================
// 辅助工具
// ============================================================================

/** 构建测试用 ChatMessage */
function msg(
  role: 'user' | 'assistant' | 'system',
  content: string,
  id?: string,
): ChatMessage {
  return {
    id: id ?? `msg-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    createdAt: Date.now(),
  }
}

// ============================================================================
// 过滤空内容助手消息
// ============================================================================

describe('filterHistory — 空内容过滤', () => {
  test('过滤掉空内容的 assistant 消息', () => {
    const history = [
      msg('user', '你好'),
      msg('assistant', ''),
      msg('user', '再见'),
      msg('assistant', '再见！'),
    ]
    const result = filterHistory(history)
    expect(result).toHaveLength(3)
    expect(result.every((m) => m.content.trim() !== '' || m.role !== 'assistant')).toBe(true)
  })

  test('过滤掉仅含空白字符的 assistant 消息', () => {
    const history = [
      msg('user', '你好'),
      msg('assistant', '   \n\t  '),
      msg('user', '问题'),
    ]
    const result = filterHistory(history)
    expect(result).toHaveLength(2)
  })

  test('保留有内容的 assistant 消息', () => {
    const history = [
      msg('user', '你好'),
      msg('assistant', '你好！'),
    ]
    const result = filterHistory(history)
    expect(result).toHaveLength(2)
  })

  test('user 消息不受空内容过滤影响', () => {
    const history = [
      msg('user', ''),
      msg('assistant', '回复'),
    ]
    // user 空内容不被过滤（只过滤 assistant）
    const result = filterHistory(history)
    expect(result).toHaveLength(2)
  })
})

// ============================================================================
// 分隔线过滤
// ============================================================================

describe('filterHistory — 分隔线过滤', () => {
  test('保留最后一个分隔线之后的消息', () => {
    const dividerMsg = msg('user', '分隔消息', 'divider-1')
    const history = [
      msg('user', '旧消息1'),
      msg('assistant', '旧回复1'),
      dividerMsg,
      msg('user', '新消息'),
      msg('assistant', '新回复'),
    ]
    const result = filterHistory(history, ['divider-1'])
    expect(result).toHaveLength(2)
    expect(result[0]!.content).toBe('新消息')
    expect(result[1]!.content).toBe('新回复')
  })

  test('多个分隔线取最后一个', () => {
    const history = [
      msg('user', '旧消息', 'div-1'),
      msg('assistant', '旧回复'),
      msg('user', '中间消息', 'div-2'),
      msg('assistant', '中间回复'),
      msg('user', '新消息'),
    ]
    const result = filterHistory(history, ['div-1', 'div-2'])
    expect(result).toHaveLength(2)
    expect(result[0]!.content).toBe('中间回复')
    expect(result[1]!.content).toBe('新消息')
  })

  test('分隔线 ID 不存在时保留全部', () => {
    const history = [
      msg('user', '消息1'),
      msg('assistant', '回复1'),
    ]
    const result = filterHistory(history, ['nonexistent-id'])
    expect(result).toHaveLength(2)
  })

  test('空分隔线数组不影响结果', () => {
    const history = [
      msg('user', '消息1'),
      msg('assistant', '回复1'),
    ]
    const result = filterHistory(history, [])
    expect(result).toHaveLength(2)
  })

  test('undefined 分隔线不影响结果', () => {
    const history = [
      msg('user', '消息1'),
      msg('assistant', '回复1'),
    ]
    const result = filterHistory(history, undefined)
    expect(result).toHaveLength(2)
  })
})

// ============================================================================
// 轮数裁剪
// ============================================================================

describe('filterHistory — 轮数裁剪', () => {
  test('contextLength=0 返回空数组', () => {
    const history = [
      msg('user', '消息1'),
      msg('assistant', '回复1'),
    ]
    const result = filterHistory(history, undefined, 0)
    expect(result).toHaveLength(0)
  })

  test('contextLength=1 保留最后 1 轮', () => {
    const history = [
      msg('user', '旧消息'),
      msg('assistant', '旧回复'),
      msg('user', '新消息'),
      msg('assistant', '新回复'),
    ]
    const result = filterHistory(history, undefined, 1)
    expect(result).toHaveLength(2)
    expect(result[0]!.content).toBe('新消息')
    expect(result[1]!.content).toBe('新回复')
  })

  test('contextLength=2 保留最后 2 轮', () => {
    const history = [
      msg('user', '第1轮'),
      msg('assistant', '回复1'),
      msg('user', '第2轮'),
      msg('assistant', '回复2'),
      msg('user', '第3轮'),
      msg('assistant', '回复3'),
    ]
    const result = filterHistory(history, undefined, 2)
    expect(result).toHaveLength(4)
    expect(result[0]!.content).toBe('第2轮')
  })

  test('contextLength 大于实际轮数时保留全部', () => {
    const history = [
      msg('user', '消息'),
      msg('assistant', '回复'),
    ]
    const result = filterHistory(history, undefined, 100)
    expect(result).toHaveLength(2)
  })

  test('contextLength="infinite" 保留全部', () => {
    const history = [
      msg('user', '消息1'),
      msg('assistant', '回复1'),
      msg('user', '消息2'),
      msg('assistant', '回复2'),
    ]
    const result = filterHistory(history, undefined, 'infinite')
    expect(result).toHaveLength(4)
  })

  test('contextLength=undefined 保留全部', () => {
    const history = [
      msg('user', '消息1'),
      msg('assistant', '回复1'),
    ]
    const result = filterHistory(history)
    expect(result).toHaveLength(2)
  })

  test('1 轮中多条 assistant 消息的处理', () => {
    // 一轮 = 从 user 到下一个 user 之间的所有消息
    // contextLength=1 应包含最后一个 user 及其后所有 assistant
    const history = [
      msg('user', '旧问题'),
      msg('assistant', '旧回复'),
      msg('user', '新问题'),
      msg('assistant', '回复A'),
      msg('assistant', '回复B'),  // 同一轮的第二条 assistant
    ]
    const result = filterHistory(history, undefined, 1)
    // 从后往前：遇到 '新问题'(user) 算 1 轮，收集 '新问题' + '回复A' + '回复B'
    expect(result).toHaveLength(3)
    expect(result[0]!.content).toBe('新问题')
  })
})

// ============================================================================
// 组合场景：分隔线 + 轮数裁剪
// ============================================================================

describe('filterHistory — 组合过滤', () => {
  test('先分隔线截断再轮数裁剪', () => {
    const history = [
      msg('user', '超旧消息'),
      msg('assistant', '超旧回复'),
      msg('user', '分隔', 'div-1'),
      msg('user', '轮1'),
      msg('assistant', '回复1'),
      msg('user', '轮2'),
      msg('assistant', '回复2'),
      msg('user', '轮3'),
      msg('assistant', '回复3'),
    ]
    // 分隔线后有 3 轮，contextLength=2 只保留最后 2 轮
    const result = filterHistory(history, ['div-1'], 2)
    expect(result).toHaveLength(4)
    expect(result[0]!.content).toBe('轮2')
  })

  test('空 assistant 过滤 + 分隔线 + 轮数裁剪', () => {
    const history = [
      msg('user', '旧消息'),
      msg('assistant', ''),  // 被过滤
      msg('user', '分隔', 'div'),
      msg('user', '消息'),
      msg('assistant', '回复'),
    ]
    const result = filterHistory(history, ['div'], 1)
    expect(result).toHaveLength(2)
    expect(result[0]!.content).toBe('消息')
  })
})
