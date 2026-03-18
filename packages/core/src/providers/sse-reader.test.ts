import { test, expect, describe, mock } from 'bun:test'
import { streamSSE, fetchTitle } from './sse-reader'
import type { ProviderAdapter, ProviderRequest, StreamEvent, StreamEventCallback } from './types'

// ============================================================================
// Mock 工具
// ============================================================================

/** 创建模拟 ReadableStream（从字符串行数组构建 SSE 流） */
function makeSSEStream(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  const text = lines.join('\n') + '\n'

  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text))
      controller.close()
    },
  })
}

/** 创建模拟 Response */
function makeResponse(lines: string[], status = 200): Response {
  return new Response(makeSSEStream(lines), {
    status,
    headers: { 'Content-Type': 'text/event-stream' },
  })
}

/** 创建简单的 mock adapter（OpenAI 风格） */
function makeMockAdapter(overrides: Partial<ProviderAdapter> = {}): ProviderAdapter {
  return {
    providerType: 'openai',
    buildStreamRequest: () => ({ url: '', headers: {}, body: '' }),
    parseSSELine: (line: string) => {
      try {
        const data = JSON.parse(line)
        const events: StreamEvent[] = []
        if (data.text) events.push({ type: 'chunk', delta: data.text })
        if (data.reasoning) events.push({ type: 'reasoning', delta: data.reasoning })
        if (data.done) events.push({ type: 'done', stopReason: data.stopReason })
        if (data.tool_start) {
          events.push({
            type: 'tool_call_start',
            toolCallId: data.tool_start.id,
            toolName: data.tool_start.name,
          })
        }
        if (data.tool_delta) {
          events.push({
            type: 'tool_call_delta',
            toolCallId: data.tool_delta.id || '',
            argumentsDelta: data.tool_delta.args,
          })
        }
        return events
      } catch {
        return []
      }
    },
    buildTitleRequest: () => ({ url: '', headers: {}, body: '' }),
    parseTitleResponse: (body: unknown) => {
      const data = body as { title?: string }
      return data.title ?? null
    },
    ...overrides,
  }
}

/** 创建模拟请求配置 */
function makeRequest(): ProviderRequest {
  return {
    url: 'https://api.example.com/v1/chat',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }
}

// ============================================================================
// streamSSE 测试
// ============================================================================

describe('streamSSE', () => {
  test('累积文本内容', async () => {
    const events: StreamEvent[] = []
    const lines = [
      'data: {"text":"Hello"}',
      'data: {"text":" World"}',
      'data: [DONE]',
    ]

    const adapter = makeMockAdapter()
    const fetchFn = mock(() => Promise.resolve(makeResponse(lines)))

    const result = await streamSSE({
      request: makeRequest(),
      adapter,
      onEvent: (e) => events.push(e),
      fetchFn,
    })

    expect(result.content).toBe('Hello World')
    expect(events.filter((e) => e.type === 'chunk')).toHaveLength(2)
    // 最后一个事件是 done
    expect(events[events.length - 1]?.type).toBe('done')
  })

  test('累积推理内容', async () => {
    const lines = [
      'data: {"reasoning":"Let me think"}',
      'data: {"reasoning":"... about this"}',
      'data: {"text":"Answer"}',
    ]

    const adapter = makeMockAdapter()
    const fetchFn = mock(() => Promise.resolve(makeResponse(lines)))

    const result = await streamSSE({
      request: makeRequest(),
      adapter,
      onEvent: () => {},
      fetchFn,
    })

    expect(result.reasoning).toBe('Let me think... about this')
    expect(result.content).toBe('Answer')
  })

  test('处理工具调用', async () => {
    const lines = [
      'data: {"tool_start":{"id":"tc-1","name":"search"}}',
      'data: {"tool_delta":{"id":"tc-1","args":"{\\"q\\":"}}',
      'data: {"tool_delta":{"args":"\\"test\\"}"}}',
    ]

    const adapter = makeMockAdapter()
    const fetchFn = mock(() => Promise.resolve(makeResponse(lines)))

    const result = await streamSSE({
      request: makeRequest(),
      adapter,
      onEvent: () => {},
      fetchFn,
    })

    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls[0]?.name).toBe('search')
    expect(result.toolCalls[0]?.arguments).toEqual({ q: 'test' })
  })

  test('工具调用 JSON 解析失败时使用空参数', async () => {
    const lines = [
      'data: {"tool_start":{"id":"tc-1","name":"search"}}',
      'data: {"tool_delta":{"id":"tc-1","args":"invalid json"}}',
    ]

    const adapter = makeMockAdapter()
    const fetchFn = mock(() => Promise.resolve(makeResponse(lines)))

    const result = await streamSSE({
      request: makeRequest(),
      adapter,
      onEvent: () => {},
      fetchFn,
    })

    expect(result.toolCalls).toHaveLength(1)
    expect(result.toolCalls[0]?.arguments).toEqual({})
  })

  test('有工具调用但无显式 stopReason 时推断为 tool_use', async () => {
    const lines = [
      'data: {"tool_start":{"id":"tc-1","name":"read"}}',
      'data: {"tool_delta":{"id":"tc-1","args":"{}"}}',
    ]

    const adapter = makeMockAdapter()
    const fetchFn = mock(() => Promise.resolve(makeResponse(lines)))

    const result = await streamSSE({
      request: makeRequest(),
      adapter,
      onEvent: () => {},
      fetchFn,
    })

    expect(result.stopReason).toBe('tool_use')
  })

  test('显式 stopReason 保留', async () => {
    const lines = [
      'data: {"text":"Hello"}',
      'data: {"done":true,"stopReason":"end_turn"}',
    ]

    const adapter = makeMockAdapter()
    const fetchFn = mock(() => Promise.resolve(makeResponse(lines)))

    const result = await streamSSE({
      request: makeRequest(),
      adapter,
      onEvent: () => {},
      fetchFn,
    })

    expect(result.stopReason).toBe('end_turn')
  })

  test('跳过 [DONE] 和空行', async () => {
    const events: StreamEvent[] = []
    const lines = [
      '',
      'data: {"text":"A"}',
      '',
      'data: [DONE]',
      'data: ',
    ]

    const adapter = makeMockAdapter()
    const fetchFn = mock(() => Promise.resolve(makeResponse(lines)))

    await streamSSE({
      request: makeRequest(),
      adapter,
      onEvent: (e) => events.push(e),
      fetchFn,
    })

    // 只有 1 个 chunk + 最终的 done
    const chunks = events.filter((e) => e.type === 'chunk')
    expect(chunks).toHaveLength(1)
  })

  test('非 200 响应抛出错误', async () => {
    const adapter = makeMockAdapter()
    const fetchFn = mock(() =>
      Promise.resolve(new Response('Unauthorized', { status: 401 })),
    )

    await expect(
      streamSSE({
        request: makeRequest(),
        adapter,
        onEvent: () => {},
        fetchFn,
      }),
    ).rejects.toThrow('openai API 错误 (401)')
  })

  test('空响应体抛出错误', async () => {
    const adapter = makeMockAdapter()
    const fetchFn = mock(() =>
      Promise.resolve(new Response(null, { status: 200 })),
    )

    await expect(
      streamSSE({
        request: makeRequest(),
        adapter,
        onEvent: () => {},
        fetchFn,
      }),
    ).rejects.toThrow('响应体为空')
  })

  test('工具调用保留 metadata', async () => {
    const lines = [
      'data: {"tool_start":{"id":"tc-1","name":"search"}}',
      'data: {"tool_delta":{"id":"tc-1","args":"{}"}}',
    ]

    const adapter = makeMockAdapter({
      parseSSELine: (line: string) => {
        try {
          const data = JSON.parse(line)
          const events: StreamEvent[] = []
          if (data.tool_start) {
            events.push({
              type: 'tool_call_start',
              toolCallId: data.tool_start.id,
              toolName: data.tool_start.name,
              metadata: { thoughtSignature: 'sig-123' },
            })
          }
          if (data.tool_delta) {
            events.push({
              type: 'tool_call_delta',
              toolCallId: data.tool_delta.id || '',
              argumentsDelta: data.tool_delta.args,
            })
          }
          return events
        } catch {
          return []
        }
      },
    })
    const fetchFn = mock(() => Promise.resolve(makeResponse(lines)))

    const result = await streamSSE({
      request: makeRequest(),
      adapter,
      onEvent: () => {},
      fetchFn,
    })

    expect(result.toolCalls[0]?.metadata).toEqual({ thoughtSignature: 'sig-123' })
  })
})

// ============================================================================
// fetchTitle 测试
// ============================================================================

describe('fetchTitle', () => {
  test('成功提取标题', async () => {
    const adapter = makeMockAdapter()
    const fetchFn = mock(() =>
      Promise.resolve(new Response(JSON.stringify({ title: 'AI 讨论' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })),
    )

    const title = await fetchTitle(makeRequest(), adapter, fetchFn)
    expect(title).toBe('AI 讨论')
  })

  test('非 200 响应返回 null', async () => {
    const adapter = makeMockAdapter()
    const fetchFn = mock(() =>
      Promise.resolve(new Response('error', { status: 500 })),
    )

    const title = await fetchTitle(makeRequest(), adapter, fetchFn)
    expect(title).toBe(null)
  })

  test('解析失败返回 null', async () => {
    const adapter = makeMockAdapter({
      parseTitleResponse: () => null,
    })
    const fetchFn = mock(() =>
      Promise.resolve(new Response(JSON.stringify({}), { status: 200 })),
    )

    const title = await fetchTitle(makeRequest(), adapter, fetchFn)
    expect(title).toBe(null)
  })

  test('fetch 异常返回 null', async () => {
    const adapter = makeMockAdapter()
    const fetchFn = mock(() => Promise.reject(new Error('network error')))

    const title = await fetchTitle(makeRequest(), adapter, fetchFn)
    expect(title).toBe(null)
  })
})
