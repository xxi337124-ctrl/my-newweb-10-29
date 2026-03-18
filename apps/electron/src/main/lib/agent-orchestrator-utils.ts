/**
 * Agent 编排层纯逻辑工具函数
 *
 * 从 agent-orchestrator.ts 提取的无 Electron 依赖的纯函数，
 * 便于独立单元测试。
 *
 * 包含：
 * - extractApiError: stderr 错误解析
 * - isAutoRetryableTypedError / isAutoRetryableCatchError: 重试判断
 * - getRetryDelayMs: 指数退避
 * - extractToolSummary: 工具活动摘要提取
 */

import type { TypedError, AgentEvent } from '@xwom/shared'

/**
 * 从 stderr 中提取 API 错误信息
 *
 * 解析类似这样的错误：
 * "401 {\"error\":{\"message\":\"...\"}}"
 * "API error: 400 Bad Request ..."
 */
export function extractApiError(stderr: string): { statusCode: number; message: string } | null {
  if (!stderr) return null

  // 模式 1：JSON 错误格式 - "401 {...}"
  // 使用贪婪匹配 \{.*\} 以支持嵌套 JSON（如 {"error":{"message":"..."}}）
  const jsonMatch = stderr.match(/(\d{3})\s+(\{.*\})/s)
  if (jsonMatch) {
    try {
      const statusCode = parseInt(jsonMatch[1]!)
      const errorObj = JSON.parse(jsonMatch[2]!)
      const message = errorObj.error?.message || errorObj.message || '未知错误'
      return { statusCode, message }
    } catch {
      // JSON 解析失败，继续尝试其他模式
    }
  }

  // 模式 2：API error 格式 - "API error (attempt X/Y): 401 401 {...}"
  const apiErrorMatch = stderr.match(/API error[^:]*:\s+(\d{3})\s+\d{3}\s+(\{.*\})/s)
  if (apiErrorMatch) {
    try {
      const statusCode = parseInt(apiErrorMatch[1]!)
      const errorObj = JSON.parse(apiErrorMatch[2]!)
      const message = errorObj.error?.message || errorObj.message || '未知错误'
      return { statusCode, message }
    } catch {
      // JSON 解析失败
    }
  }

  // 模式 3：直接的状态码 + 消息
  const simpleMatch = stderr.match(/(\d{3})[:\s]+(.+?)(?:\n|$)/i)
  if (simpleMatch) {
    const statusCode = parseInt(simpleMatch[1]!)
    const message = simpleMatch[2]!.trim()
    if (statusCode >= 400 && statusCode < 600) {
      return { statusCode, message }
    }
  }

  return null
}

// ===== 自动重试工具函数 =====

/** 可自动重试的 TypedError 错误码 */
const AUTO_RETRYABLE_ERROR_CODES: ReadonlySet<string> = new Set([
  'rate_limited',
  'provider_error',      // overloaded 映射为 provider_error
  'service_error',
  'service_unavailable',
  'network_error',
])

/** 判断 typed_error 事件是否可自动重试 */
export function isAutoRetryableTypedError(error: TypedError): boolean {
  return AUTO_RETRYABLE_ERROR_CODES.has(error.code)
}

/** 判断 catch 块中的 API 错误是否可自动重试（HTTP 429 / 5xx / 已知可恢复错误模式） */
export function isAutoRetryableCatchError(
  apiError: { statusCode: number; message: string } | null,
  rawErrorMessage?: string,
): boolean {
  if (apiError) {
    if (apiError.statusCode === 429 || apiError.statusCode >= 500) return true
  }
  // 已知的可恢复错误模式（无 HTTP 状态码但可重试）
  if (rawErrorMessage) {
    if (rawErrorMessage.includes('context_management')) return true
  }
  return false
}

/** 最大自动重试次数 */
export const MAX_AUTO_RETRIES = 3

/** 计算重试延迟（指数退避：1s, 2s, 4s） */
export function getRetryDelayMs(attempt: number): number {
  return Math.min(1000 * Math.pow(2, attempt - 1), 8000)
}

/**
 * 可中断的定时器
 *
 * 等待指定毫秒，如果 signal 被中止则立即 resolve。
 */
export function timerWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) { resolve(); return }
    const tid = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => { clearTimeout(tid); resolve() }, { once: true })
  })
}

/** 单条工具摘要最大字符数 */
export const MAX_TOOL_SUMMARY_LENGTH = 200

/**
 * 从 assistant 消息的 events 中提取工具活动摘要
 *
 * 返回简要的工具名称 + 关键输入信息，帮助新 SDK 会话理解之前做过什么。
 */
export function extractToolSummary(events: AgentEvent[]): string {
  const summaries: string[] = []
  for (const event of events) {
    if (event.type === 'tool_start') {
      const input = event.input
      // 提取关键输入参数（如 file_path、command 等）
      const keyParam = input.file_path ?? input.command ?? input.path ?? input.query ?? ''
      const paramStr = keyParam ? `: ${String(keyParam).slice(0, 100)}` : ''
      summaries.push(`[tool: ${event.toolName}${paramStr}]`)
    }
  }
  if (summaries.length === 0) return ''
  const joined = summaries.join(' ')
  return joined.length > MAX_TOOL_SUMMARY_LENGTH
    ? joined.slice(0, MAX_TOOL_SUMMARY_LENGTH) + '...'
    : joined
}
