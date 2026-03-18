import { test, expect, describe } from 'bun:test'
import { AnthropicAdapter } from './anthropic-adapter'
import { OpenAIAdapter } from './openai-adapter'
import { GoogleAdapter } from './google-adapter'
import { getAdapter } from './index'
import type { StreamRequestInput, TitleRequestInput, ImageAttachmentReader } from './types'

// ============================================================================
// 辅助工具
// ============================================================================

/** 空图片读取器（不返回任何图片） */
const noImages: ImageAttachmentReader = () => []

/** 构建最小 StreamRequestInput */
function makeStreamInput(overrides: Partial<StreamRequestInput> = {}): StreamRequestInput {
  return {
    baseUrl: 'https://api.anthropic.com',
    apiKey: 'test-key-123',
    modelId: 'claude-sonnet-4-20250514',
    history: [],
    userMessage: '你好',
    readImageAttachments: noImages,
    ...overrides,
  }
}

/** 构建最小 TitleRequestInput */
function makeTitleInput(overrides: Partial<TitleRequestInput> = {}): TitleRequestInput {
  return {
    baseUrl: 'https://api.anthropic.com',
    apiKey: 'test-key-123',
    modelId: 'claude-sonnet-4-20250514',
    prompt: '请为以下对话生成一个简短标题',
    ...overrides,
  }
}

// ============================================================================
// getAdapter 注册表测试
// ============================================================================

describe('getAdapter 注册表', () => {
  test('anthropic 返回 AnthropicAdapter', () => {
    const adapter = getAdapter('anthropic')
    expect(adapter).toBeInstanceOf(AnthropicAdapter)
    expect(adapter.providerType).toBe('anthropic')
  })

  test('openai 返回 OpenAIAdapter', () => {
    const adapter = getAdapter('openai')
    expect(adapter).toBeInstanceOf(OpenAIAdapter)
  })

  test('deepseek 使用 OpenAI 兼容适配器', () => {
    const adapter = getAdapter('deepseek')
    expect(adapter).toBeInstanceOf(OpenAIAdapter)
  })

  test('google 返回 GoogleAdapter', () => {
    const adapter = getAdapter('google')
    expect(adapter).toBeInstanceOf(GoogleAdapter)
  })

  test('custom 使用 OpenAI 兼容适配器', () => {
    const adapter = getAdapter('custom')
    expect(adapter).toBeInstanceOf(OpenAIAdapter)
  })

  test('不支持的供应商抛出错误', () => {
    expect(() => getAdapter('unknown' as never)).toThrow('不支持的供应商')
  })
})

// ============================================================================
// AnthropicAdapter 测试
// ============================================================================

describe('AnthropicAdapter', () => {
  const adapter = new AnthropicAdapter()

  describe('buildStreamRequest', () => {
    test('基本请求结构正确', () => {
      const input = makeStreamInput()
      const req = adapter.buildStreamRequest(input)

      expect(req.url).toBe('https://api.anthropic.com/v1/messages')
      expect(req.headers['x-api-key']).toBe('test-key-123')
      expect(req.headers['anthropic-version']).toBe('2023-06-01')
      expect(req.headers['content-type']).toBe('application/json')

      const body = JSON.parse(req.body)
      expect(body.model).toBe('claude-sonnet-4-20250514')
      expect(body.stream).toBe(true)
      expect(body.messages).toHaveLength(1)
      expect(body.messages[0].role).toBe('user')
      expect(body.messages[0].content).toBe('你好')
    })

    test('启用 thinking 模式', () => {
      const input = makeStreamInput({ thinkingEnabled: true })
      const req = adapter.buildStreamRequest(input)
      const body = JSON.parse(req.body)

      expect(body.thinking).toEqual({
        type: 'enabled',
        budget_tokens: 16384,
      })
      // 启用时 max_tokens 更大
      expect(body.max_tokens).toBe(16384 + 16384)
    })

    test('不启用 thinking 时 max_tokens 较小', () => {
      const input = makeStreamInput({ thinkingEnabled: false })
      const req = adapter.buildStreamRequest(input)
      const body = JSON.parse(req.body)

      expect(body.thinking).toBeUndefined()
      expect(body.max_tokens).toBe(8192)
    })

    test('包含 system 消息', () => {
      const input = makeStreamInput({ systemMessage: '你是一个助手' })
      const req = adapter.buildStreamRequest(input)
      const body = JSON.parse(req.body)

      // Anthropic 通过 body.system 传递
      expect(body.system).toBe('你是一个助手')
    })

    test('历史消息转换', () => {
      const input = makeStreamInput({
        history: [
          { role: 'user' as const, content: '上一条消息', timestamp: Date.now() },
          { role: 'assistant' as const, content: '回复', timestamp: Date.now() },
        ],
      })
      const req = adapter.buildStreamRequest(input)
      const body = JSON.parse(req.body)

      // 2 条历史 + 1 条当前
      expect(body.messages).toHaveLength(3)
      expect(body.messages[0].role).toBe('user')
      expect(body.messages[0].content).toBe('上一条消息')
      expect(body.messages[1].role).toBe('assistant')
      expect(body.messages[2].role).toBe('user')
      expect(body.messages[2].content).toBe('你好')
    })

    test('过滤 system 角色历史消息', () => {
      const input = makeStreamInput({
        history: [
          { role: 'system' as const, content: '系统消息', timestamp: Date.now() },
          { role: 'user' as const, content: '问题', timestamp: Date.now() },
        ],
      })
      const req = adapter.buildStreamRequest(input)
      const body = JSON.parse(req.body)

      // system 被过滤，只有 user 历史 + 当前
      expect(body.messages).toHaveLength(2)
    })

    test('包含工具定义', () => {
      const input = makeStreamInput({
        tools: [{
          name: 'get_weather',
          description: '获取天气',
          parameters: {
            type: 'object' as const,
            properties: { city: { type: 'string', description: '城市' } },
            required: ['city'],
          },
        }],
      })
      const req = adapter.buildStreamRequest(input)
      const body = JSON.parse(req.body)

      expect(body.tools).toHaveLength(1)
      expect(body.tools[0].name).toBe('get_weather')
      expect(body.tools[0].input_schema).toBeDefined()
    })

    test('图片附件转换为 Anthropic 格式', () => {
      const input = makeStreamInput({
        attachments: [{ id: 'att-1', name: 'test.png', path: '/tmp/test.png', size: 100, type: 'image/png' }],
        readImageAttachments: () => [{
          mediaType: 'image/png',
          data: 'base64data',
        }],
      })
      const req = adapter.buildStreamRequest(input)
      const body = JSON.parse(req.body)

      const lastMsg = body.messages[body.messages.length - 1]
      expect(Array.isArray(lastMsg.content)).toBe(true)
      expect(lastMsg.content[0].type).toBe('image')
      expect(lastMsg.content[0].source.type).toBe('base64')
      expect(lastMsg.content[0].source.data).toBe('base64data')
    })
  })

  describe('parseSSELine', () => {
    test('解析 text_delta', () => {
      const line = JSON.stringify({
        type: 'content_block_delta',
        delta: { type: 'text_delta', text: 'Hello' },
      })
      const events = adapter.parseSSELine(line)
      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({ type: 'chunk', delta: 'Hello' })
    })

    test('解析 thinking_delta', () => {
      const line = JSON.stringify({
        type: 'content_block_delta',
        delta: { type: 'thinking_delta', thinking: '让我想想...' },
      })
      const events = adapter.parseSSELine(line)
      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({ type: 'reasoning', delta: '让我想想...' })
    })

    test('解析工具调用开始', () => {
      const line = JSON.stringify({
        type: 'content_block_start',
        content_block: { type: 'tool_use', id: 'tc-1', name: 'Read' },
      })
      const events = adapter.parseSSELine(line)
      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({
        type: 'tool_call_start',
        toolCallId: 'tc-1',
        toolName: 'Read',
      })
    })

    test('解析工具参数增量', () => {
      const line = JSON.stringify({
        type: 'content_block_delta',
        delta: { type: 'input_json_delta', partial_json: '{"path":' },
      })
      const events = adapter.parseSSELine(line)
      expect(events).toHaveLength(1)
      expect(events[0]?.type).toBe('tool_call_delta')
    })

    test('解析 message_delta stop_reason', () => {
      const line = JSON.stringify({
        type: 'message_delta',
        delta: { stop_reason: 'end_turn' },
      })
      const events = adapter.parseSSELine(line)
      expect(events).toHaveLength(1)
      expect(events[0]).toEqual({ type: 'done', stopReason: 'end_turn' })
    })

    test('无效 JSON 返回空数组', () => {
      expect(adapter.parseSSELine('not json')).toEqual([])
    })

    test('无关事件返回空数组', () => {
      const line = JSON.stringify({ type: 'ping' })
      expect(adapter.parseSSELine(line)).toEqual([])
    })
  })

  describe('buildTitleRequest', () => {
    test('正确构建标题请求', () => {
      const input = makeTitleInput()
      const req = adapter.buildTitleRequest(input)

      expect(req.url).toBe('https://api.anthropic.com/v1/messages')
      const body = JSON.parse(req.body)
      expect(body.max_tokens).toBe(50)
      expect(body.thinking).toEqual({ type: 'disabled' })
    })
  })

  describe('parseTitleResponse', () => {
    test('提取 text 块', () => {
      const response = {
        content: [{ type: 'text', text: 'AI 助手讨论' }],
      }
      expect(adapter.parseTitleResponse(response)).toBe('AI 助手讨论')
    })

    test('空 content 返回 null', () => {
      expect(adapter.parseTitleResponse({ content: [] })).toBe(null)
    })

    test('无 content 返回 null', () => {
      expect(adapter.parseTitleResponse({})).toBe(null)
    })

    test('从 thinking 块提取标题（MiniMax 兼容）', () => {
      const response = {
        content: [{ type: 'thinking', thinking: '分析对话\n- AI 助手讨论' }],
      }
      expect(adapter.parseTitleResponse(response)).toBe('AI 助手讨论')
    })
  })
})

// ============================================================================
// OpenAIAdapter 测试
// ============================================================================

describe('OpenAIAdapter', () => {
  const adapter = new OpenAIAdapter()

  describe('buildStreamRequest', () => {
    test('基本请求结构正确', () => {
      const input = makeStreamInput({
        baseUrl: 'https://api.openai.com/v1',
        modelId: 'gpt-4',
      })
      const req = adapter.buildStreamRequest(input)

      expect(req.url).toBe('https://api.openai.com/v1/chat/completions')
      expect(req.headers['Authorization']).toBe('Bearer test-key-123')

      const body = JSON.parse(req.body)
      expect(body.model).toBe('gpt-4')
      expect(body.stream).toBe(true)
    })

    test('system 消息作为独立角色', () => {
      const input = makeStreamInput({
        baseUrl: 'https://api.openai.com/v1',
        systemMessage: '你是助手',
      })
      const req = adapter.buildStreamRequest(input)
      const body = JSON.parse(req.body)

      expect(body.messages[0].role).toBe('system')
      expect(body.messages[0].content).toBe('你是助手')
    })

    test('包含图片时使用多模态格式', () => {
      const input = makeStreamInput({
        baseUrl: 'https://api.openai.com/v1',
        readImageAttachments: () => [{ mediaType: 'image/png', data: 'base64data' }],
        attachments: [{ id: 'att-1', name: 'img.png', path: '/tmp/img.png', size: 100, type: 'image/png' }],
      })
      const req = adapter.buildStreamRequest(input)
      const body = JSON.parse(req.body)

      const lastMsg = body.messages[body.messages.length - 1]
      expect(Array.isArray(lastMsg.content)).toBe(true)
      expect(lastMsg.content[0].type).toBe('image_url')
      expect(lastMsg.content[0].image_url.url).toContain('data:image/png;base64,')
    })

    test('包含工具定义（OpenAI 格式）', () => {
      const input = makeStreamInput({
        baseUrl: 'https://api.openai.com/v1',
        tools: [{
          name: 'search',
          description: '搜索',
          parameters: { type: 'object' as const, properties: { q: { type: 'string' } } },
        }],
      })
      const req = adapter.buildStreamRequest(input)
      const body = JSON.parse(req.body)

      expect(body.tools[0].type).toBe('function')
      expect(body.tools[0].function.name).toBe('search')
    })
  })

  describe('parseSSELine', () => {
    test('解析文本增量', () => {
      const line = JSON.stringify({
        choices: [{ delta: { content: 'Hello' } }],
      })
      const events = adapter.parseSSELine(line)
      expect(events).toEqual([{ type: 'chunk', delta: 'Hello' }])
    })

    test('解析 DeepSeek 推理内容', () => {
      const line = JSON.stringify({
        choices: [{ delta: { reasoning_content: '思考中...' } }],
      })
      const events = adapter.parseSSELine(line)
      expect(events).toEqual([{ type: 'reasoning', delta: '思考中...' }])
    })

    test('解析工具调用', () => {
      const line = JSON.stringify({
        choices: [{
          delta: {
            tool_calls: [{
              id: 'call-1',
              function: { name: 'search', arguments: '{"q":' },
            }],
          },
        }],
      })
      const events = adapter.parseSSELine(line)

      expect(events).toHaveLength(2)
      expect(events[0]).toEqual({
        type: 'tool_call_start',
        toolCallId: 'call-1',
        toolName: 'search',
      })
      expect(events[1]?.type).toBe('tool_call_delta')
    })

    test('finish_reason tool_calls → done/tool_use', () => {
      const line = JSON.stringify({
        choices: [{ finish_reason: 'tool_calls', delta: {} }],
      })
      const events = adapter.parseSSELine(line)
      expect(events).toContainEqual({ type: 'done', stopReason: 'tool_use' })
    })

    test('无效 JSON 返回空数组', () => {
      expect(adapter.parseSSELine('invalid')).toEqual([])
    })
  })

  describe('parseTitleResponse', () => {
    test('提取标题', () => {
      const response = {
        choices: [{ message: { content: 'AI 讨论' } }],
      }
      expect(adapter.parseTitleResponse(response)).toBe('AI 讨论')
    })

    test('空响应返回 null', () => {
      expect(adapter.parseTitleResponse({})).toBe(null)
      expect(adapter.parseTitleResponse({ choices: [] })).toBe(null)
    })
  })
})

// ============================================================================
// GoogleAdapter 测试
// ============================================================================

describe('GoogleAdapter', () => {
  const adapter = new GoogleAdapter()

  describe('buildStreamRequest', () => {
    test('基本请求结构正确', () => {
      const input = makeStreamInput({
        baseUrl: 'https://generativelanguage.googleapis.com',
        modelId: 'gemini-2.5-flash',
      })
      const req = adapter.buildStreamRequest(input)

      expect(req.url).toContain('/v1beta/models/gemini-2.5-flash:streamGenerateContent')
      expect(req.url).toContain('alt=sse')
      expect(req.url).toContain('key=test-key-123')
      // Google 用 URL 参数认证，不设 Authorization
      expect(req.headers['Authorization']).toBeUndefined()

      const body = JSON.parse(req.body)
      expect(body.contents).toHaveLength(1)
      expect(body.contents[0].role).toBe('user')
      expect(body.contents[0].parts[0].text).toBe('你好')
    })

    test('assistant 映射为 model 角色', () => {
      const input = makeStreamInput({
        baseUrl: 'https://generativelanguage.googleapis.com',
        history: [
          { role: 'user' as const, content: '你好', timestamp: Date.now() },
          { role: 'assistant' as const, content: '你好！', timestamp: Date.now() },
        ],
      })
      const req = adapter.buildStreamRequest(input)
      const body = JSON.parse(req.body)

      expect(body.contents[1].role).toBe('model')
    })

    test('system 消息通过 systemInstruction 传递', () => {
      const input = makeStreamInput({
        baseUrl: 'https://generativelanguage.googleapis.com',
        systemMessage: '你是助手',
      })
      const req = adapter.buildStreamRequest(input)
      const body = JSON.parse(req.body)

      expect(body.systemInstruction).toEqual({
        parts: [{ text: '你是助手' }],
      })
    })

    test('启用 thinking 模式', () => {
      const input = makeStreamInput({
        baseUrl: 'https://generativelanguage.googleapis.com',
        thinkingEnabled: true,
      })
      const req = adapter.buildStreamRequest(input)
      const body = JSON.parse(req.body)

      expect(body.generationConfig.thinkingConfig).toEqual({
        includeThoughts: true,
        thinkingBudget: 16384,
      })
    })

    test('不启用 thinking 时无 generationConfig', () => {
      const input = makeStreamInput({
        baseUrl: 'https://generativelanguage.googleapis.com',
      })
      const req = adapter.buildStreamRequest(input)
      const body = JSON.parse(req.body)

      expect(body.generationConfig).toBeUndefined()
    })

    test('工具转换为 Google functionDeclarations 格式', () => {
      const input = makeStreamInput({
        baseUrl: 'https://generativelanguage.googleapis.com',
        tools: [{
          name: 'search',
          description: '搜索',
          parameters: { type: 'object' as const, properties: { q: { type: 'string' } } },
        }],
      })
      const req = adapter.buildStreamRequest(input)
      const body = JSON.parse(req.body)

      expect(body.tools[0].functionDeclarations[0].name).toBe('search')
    })
  })

  describe('parseSSELine', () => {
    test('解析普通文本', () => {
      const line = JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'Hello' }] } }],
      })
      const events = adapter.parseSSELine(line)
      expect(events).toEqual([{ type: 'chunk', delta: 'Hello' }])
    })

    test('解析思考内容', () => {
      const line = JSON.stringify({
        candidates: [{ content: { parts: [{ text: '思考中...', thought: true }] } }],
      })
      const events = adapter.parseSSELine(line)
      expect(events).toEqual([{ type: 'reasoning', delta: '思考中...' }])
    })

    test('混合思考和普通文本', () => {
      const line = JSON.stringify({
        candidates: [{
          content: {
            parts: [
              { text: '思考中...', thought: true },
              { text: '回答：你好' },
            ],
          },
        }],
      })
      const events = adapter.parseSSELine(line)
      expect(events).toHaveLength(2)
      expect(events[0]).toEqual({ type: 'reasoning', delta: '思考中...' })
      expect(events[1]).toEqual({ type: 'chunk', delta: '回答：你好' })
    })

    test('解析 functionCall', () => {
      const line = JSON.stringify({
        candidates: [{
          content: {
            parts: [{
              functionCall: { name: 'search', args: { q: 'test' } },
            }],
          },
        }],
      })
      const events = adapter.parseSSELine(line)

      expect(events).toHaveLength(2)
      expect(events[0]).toEqual({
        type: 'tool_call_start',
        toolCallId: 'search',
        toolName: 'search',
        metadata: undefined,
      })
      expect(events[1]?.type).toBe('tool_call_delta')
    })

    test('functionCall 保留 thoughtSignature', () => {
      const line = JSON.stringify({
        candidates: [{
          content: {
            parts: [{
              functionCall: { name: 'search', args: {} },
              thoughtSignature: 'sig-abc',
            }],
          },
        }],
      })
      const events = adapter.parseSSELine(line)
      expect(events[0]?.metadata).toEqual({ thoughtSignature: 'sig-abc' })
    })

    test('无效 JSON 返回空数组', () => {
      expect(adapter.parseSSELine('invalid')).toEqual([])
    })

    test('空 candidates 返回空数组', () => {
      expect(adapter.parseSSELine(JSON.stringify({}))).toEqual([])
      expect(adapter.parseSSELine(JSON.stringify({ candidates: [] }))).toEqual([])
    })
  })

  describe('buildTitleRequest', () => {
    test('使用 generateContent（非流式）', () => {
      const input = makeTitleInput({
        baseUrl: 'https://generativelanguage.googleapis.com',
        modelId: 'gemini-2.5-flash',
      })
      const req = adapter.buildTitleRequest(input)

      expect(req.url).toContain(':generateContent')
      expect(req.url).not.toContain('streamGenerateContent')
      expect(req.url).toContain('key=test-key-123')

      const body = JSON.parse(req.body)
      expect(body.generationConfig.maxOutputTokens).toBe(50)
    })
  })

  describe('parseTitleResponse', () => {
    test('提取标题', () => {
      const response = {
        candidates: [{ content: { parts: [{ text: 'AI 讨论' }] } }],
      }
      expect(adapter.parseTitleResponse(response)).toBe('AI 讨论')
    })

    test('空响应返回 null', () => {
      expect(adapter.parseTitleResponse({})).toBe(null)
    })
  })
})
