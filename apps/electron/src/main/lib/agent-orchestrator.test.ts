/**
 * agent-orchestrator.ts 纯逻辑单元测试
 *
 * 测试从编排层提取的纯函数：
 * - extractApiError: stderr 错误解析
 * - isAutoRetryableTypedError / isAutoRetryableCatchError: 重试判断
 * - getRetryDelayMs: 指数退避
 * - extractToolSummary: 工具活动摘要提取
 */

import { test, expect, describe } from 'bun:test'
import {
  extractApiError,
  isAutoRetryableTypedError,
  isAutoRetryableCatchError,
  getRetryDelayMs,
  extractToolSummary,
  MAX_TOOL_SUMMARY_LENGTH,
  MAX_AUTO_RETRIES,
} from './agent-orchestrator-utils'
import type { AgentEvent } from '@xwom/shared'

// ============================================================================
// extractApiError 测试
// ============================================================================

describe('extractApiError', () => {
  test('空字符串返回 null', () => {
    expect(extractApiError('')).toBe(null)
  })

  test('解析 JSON 错误格式: "401 {error:...}"', () => {
    const stderr = '401 {"error":{"message":"Invalid API key"}}'
    const result = extractApiError(stderr)
    expect(result).toEqual({ statusCode: 401, message: 'Invalid API key' })
  })

  test('解析 JSON 错误格式: message 在顶层', () => {
    const stderr = '500 {"error":{"message":"Internal server error"}}'
    const result = extractApiError(stderr)
    expect(result).toEqual({ statusCode: 500, message: 'Internal server error' })
  })

  test('解析 API error 格式: "API error (attempt X/Y): 429 429 {...}"', () => {
    const stderr = 'API error (attempt 1/3): 429 429 {"error":{"message":"Rate limited"}}'
    const result = extractApiError(stderr)
    expect(result).toEqual({ statusCode: 429, message: 'Rate limited' })
  })

  test('解析简单状态码格式: "400: Bad request"', () => {
    const stderr = '400: Bad request message'
    const result = extractApiError(stderr)
    expect(result).not.toBe(null)
    expect(result!.statusCode).toBe(400)
  })

  test('非错误状态码（200）不匹配', () => {
    const stderr = '200: OK'
    const result = extractApiError(stderr)
    // 200 不在 400-600 范围
    expect(result).toBe(null)
  })

  test('无法解析的内容返回 null', () => {
    expect(extractApiError('some random error text without status code')).toBe(null)
  })

  test('JSON 解析失败时回退到模式 3', () => {
    const stderr = '401 {invalid json} and then 500: fallback message'
    const result = extractApiError(stderr)
    // 模式 1 匹配到 "{invalid json}" 但 JSON.parse 失败，
    // 模式 3 匹配 "401: ..." (第一个 3 位数字)
    expect(result).not.toBe(null)
    expect(result!.statusCode).toBe(401)
  })
})

// ============================================================================
// isAutoRetryableTypedError 测试
// ============================================================================

describe('isAutoRetryableTypedError', () => {
  test('rate_limited 可重试', () => {
    expect(isAutoRetryableTypedError({ code: 'rate_limited', message: '' })).toBe(true)
  })

  test('provider_error 可重试', () => {
    expect(isAutoRetryableTypedError({ code: 'provider_error', message: '' })).toBe(true)
  })

  test('service_error 可重试', () => {
    expect(isAutoRetryableTypedError({ code: 'service_error', message: '' })).toBe(true)
  })

  test('service_unavailable 可重试', () => {
    expect(isAutoRetryableTypedError({ code: 'service_unavailable', message: '' })).toBe(true)
  })

  test('network_error 可重试', () => {
    expect(isAutoRetryableTypedError({ code: 'network_error', message: '' })).toBe(true)
  })

  test('authentication_error 不可重试', () => {
    expect(isAutoRetryableTypedError({ code: 'authentication_error', message: '' })).toBe(false)
  })

  test('invalid_request 不可重试', () => {
    expect(isAutoRetryableTypedError({ code: 'invalid_request', message: '' })).toBe(false)
  })

  test('未知错误码不可重试', () => {
    expect(isAutoRetryableTypedError({ code: 'unknown_code', message: '' })).toBe(false)
  })
})

// ============================================================================
// isAutoRetryableCatchError 测试
// ============================================================================

describe('isAutoRetryableCatchError', () => {
  test('HTTP 429 可重试', () => {
    expect(isAutoRetryableCatchError({ statusCode: 429, message: 'Rate limited' })).toBe(true)
  })

  test('HTTP 500 可重试', () => {
    expect(isAutoRetryableCatchError({ statusCode: 500, message: 'Internal error' })).toBe(true)
  })

  test('HTTP 502 可重试', () => {
    expect(isAutoRetryableCatchError({ statusCode: 502, message: 'Bad gateway' })).toBe(true)
  })

  test('HTTP 503 可重试', () => {
    expect(isAutoRetryableCatchError({ statusCode: 503, message: 'Service unavailable' })).toBe(true)
  })

  test('HTTP 401 不可重试', () => {
    expect(isAutoRetryableCatchError({ statusCode: 401, message: 'Unauthorized' })).toBe(false)
  })

  test('HTTP 400 不可重试', () => {
    expect(isAutoRetryableCatchError({ statusCode: 400, message: 'Bad request' })).toBe(false)
  })

  test('context_management 错误可重试', () => {
    expect(isAutoRetryableCatchError(null, 'Error: context_management issue')).toBe(true)
  })

  test('null apiError 且无匹配消息不可重试', () => {
    expect(isAutoRetryableCatchError(null, 'some random error')).toBe(false)
  })

  test('null apiError 且无 rawErrorMessage 不可重试', () => {
    expect(isAutoRetryableCatchError(null)).toBe(false)
  })
})

// ============================================================================
// getRetryDelayMs 测试
// ============================================================================

describe('getRetryDelayMs', () => {
  test('第 1 次重试延迟 1000ms', () => {
    expect(getRetryDelayMs(1)).toBe(1000)
  })

  test('第 2 次重试延迟 2000ms', () => {
    expect(getRetryDelayMs(2)).toBe(2000)
  })

  test('第 3 次重试延迟 4000ms', () => {
    expect(getRetryDelayMs(3)).toBe(4000)
  })

  test('最大延迟不超过 8000ms', () => {
    expect(getRetryDelayMs(4)).toBe(8000)
    expect(getRetryDelayMs(10)).toBe(8000)
  })

  test('MAX_AUTO_RETRIES 为 3', () => {
    expect(MAX_AUTO_RETRIES).toBe(3)
  })
})

// ============================================================================
// extractToolSummary 测试
// ============================================================================

describe('extractToolSummary', () => {
  test('空事件列表返回空字符串', () => {
    expect(extractToolSummary([])).toBe('')
  })

  test('无 tool_start 事件返回空字符串', () => {
    const events: AgentEvent[] = [
      { type: 'text', text: 'hello' } as AgentEvent,
    ]
    expect(extractToolSummary(events)).toBe('')
  })

  test('提取单个工具调用摘要', () => {
    const events: AgentEvent[] = [
      {
        type: 'tool_start',
        toolName: 'Read',
        toolUseId: 'tu-1',
        input: { file_path: '/src/main.ts' },
      } as AgentEvent,
    ]
    const result = extractToolSummary(events)
    expect(result).toBe('[tool: Read: /src/main.ts]')
  })

  test('提取多个工具调用摘要', () => {
    const events: AgentEvent[] = [
      {
        type: 'tool_start',
        toolName: 'Bash',
        toolUseId: 'tu-1',
        input: { command: 'ls -la' },
      } as AgentEvent,
      {
        type: 'tool_start',
        toolName: 'Read',
        toolUseId: 'tu-2',
        input: { path: '/foo.txt' },
      } as AgentEvent,
    ]
    const result = extractToolSummary(events)
    expect(result).toContain('[tool: Bash: ls -la]')
    expect(result).toContain('[tool: Read: /foo.txt]')
  })

  test('无参数的工具调用', () => {
    const events: AgentEvent[] = [
      {
        type: 'tool_start',
        toolName: 'WebSearch',
        toolUseId: 'tu-1',
        input: {},
      } as AgentEvent,
    ]
    const result = extractToolSummary(events)
    expect(result).toBe('[tool: WebSearch]')
  })

  test('query 参数提取', () => {
    const events: AgentEvent[] = [
      {
        type: 'tool_start',
        toolName: 'Grep',
        toolUseId: 'tu-1',
        input: { query: 'TODO' },
      } as AgentEvent,
    ]
    const result = extractToolSummary(events)
    expect(result).toBe('[tool: Grep: TODO]')
  })

  test('超长摘要截断', () => {
    // 生成足够多的工具事件以超过 MAX_TOOL_SUMMARY_LENGTH
    const events: AgentEvent[] = Array.from({ length: 30 }, (_, i) => ({
      type: 'tool_start' as const,
      toolName: 'Read',
      toolUseId: `tu-${i}`,
      input: { file_path: `/very/long/path/to/file-${i}.ts` },
    })) as AgentEvent[]

    const result = extractToolSummary(events)
    expect(result.length).toBeLessThanOrEqual(MAX_TOOL_SUMMARY_LENGTH + 3) // +3 for "..."
    expect(result.endsWith('...')).toBe(true)
  })

  test('忽略非 tool_start 事件', () => {
    const events: AgentEvent[] = [
      { type: 'text', text: 'thinking...' } as AgentEvent,
      {
        type: 'tool_start',
        toolName: 'Read',
        toolUseId: 'tu-1',
        input: { file_path: '/a.ts' },
      } as AgentEvent,
      { type: 'tool_result', toolUseId: 'tu-1', result: 'ok' } as AgentEvent,
    ]
    const result = extractToolSummary(events)
    expect(result).toBe('[tool: Read: /a.ts]')
  })

  test('参数值截断至 100 字符', () => {
    const longCommand = 'a'.repeat(200)
    const events: AgentEvent[] = [
      {
        type: 'tool_start',
        toolName: 'Bash',
        toolUseId: 'tu-1',
        input: { command: longCommand },
      } as AgentEvent,
    ]
    const result = extractToolSummary(events)
    // 参数截断到 100，再加上 "[tool: Bash: "
    expect(result).toContain('a'.repeat(100))
    expect(result).not.toContain('a'.repeat(101))
  })
})
