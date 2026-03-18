import { test, expect, describe } from 'bun:test'
import {
  normalizeAnthropicBaseUrl,
  normalizeAnthropicBaseUrlForSdk,
  normalizeBaseUrl,
} from './url-utils'

describe('normalizeAnthropicBaseUrl（Chat 直接调用）', () => {
  test('裸域名追加 /v1', () => {
    expect(normalizeAnthropicBaseUrl('https://api.anthropic.com')).toBe(
      'https://api.anthropic.com/v1',
    )
  })

  test('已有版本路径不变', () => {
    expect(normalizeAnthropicBaseUrl('https://api.anthropic.com/v1')).toBe(
      'https://api.anthropic.com/v1',
    )
  })

  test('去除尾部斜杠', () => {
    expect(normalizeAnthropicBaseUrl('https://api.anthropic.com/v1/')).toBe(
      'https://api.anthropic.com/v1',
    )
  })

  test('去除多余尾部斜杠', () => {
    expect(normalizeAnthropicBaseUrl('https://api.anthropic.com/v1///')).toBe(
      'https://api.anthropic.com/v1',
    )
  })

  test('去除误填的 /messages 后缀', () => {
    expect(normalizeAnthropicBaseUrl('https://proxy.example.com/v1/messages')).toBe(
      'https://proxy.example.com/v1',
    )
  })

  test('去除 /messages/ 后缀（带尾部斜杠）', () => {
    expect(normalizeAnthropicBaseUrl('https://proxy.example.com/v1/messages/')).toBe(
      'https://proxy.example.com/v1',
    )
  })

  test('自定义版本路径 /v2 保留', () => {
    expect(normalizeAnthropicBaseUrl('https://proxy.example.com/v2/')).toBe(
      'https://proxy.example.com/v2',
    )
  })

  test('去除前后空格', () => {
    expect(normalizeAnthropicBaseUrl('  https://api.anthropic.com  ')).toBe(
      'https://api.anthropic.com/v1',
    )
  })
})

describe('normalizeAnthropicBaseUrlForSdk（Agent SDK 环境变量）', () => {
  test('裸域名保持不变', () => {
    expect(normalizeAnthropicBaseUrlForSdk('https://api.anthropic.com')).toBe(
      'https://api.anthropic.com',
    )
  })

  test('去除 /v1', () => {
    expect(normalizeAnthropicBaseUrlForSdk('https://api.anthropic.com/v1')).toBe(
      'https://api.anthropic.com',
    )
  })

  test('去除 /v1/messages', () => {
    expect(normalizeAnthropicBaseUrlForSdk('https://api.anthropic.com/v1/messages')).toBe(
      'https://api.anthropic.com',
    )
  })

  test('代理网关路径保留前缀', () => {
    expect(
      normalizeAnthropicBaseUrlForSdk('https://gateway.example.com/anthropic/v1/messages'),
    ).toBe('https://gateway.example.com/anthropic')
  })

  test('去除尾部斜杠', () => {
    expect(normalizeAnthropicBaseUrlForSdk('https://gateway.example.com/anthropic/')).toBe(
      'https://gateway.example.com/anthropic',
    )
  })

  test('去除前后空格', () => {
    expect(normalizeAnthropicBaseUrlForSdk('  https://api.anthropic.com/v1  ')).toBe(
      'https://api.anthropic.com',
    )
  })
})

describe('normalizeBaseUrl（通用 URL）', () => {
  test('去除尾部斜杠', () => {
    expect(normalizeBaseUrl('https://api.openai.com/v1/')).toBe(
      'https://api.openai.com/v1',
    )
  })

  test('去除多余尾部斜杠', () => {
    expect(normalizeBaseUrl('https://api.openai.com/v1///')).toBe(
      'https://api.openai.com/v1',
    )
  })

  test('无尾部斜杠时保持不变', () => {
    expect(normalizeBaseUrl('https://api.openai.com/v1')).toBe(
      'https://api.openai.com/v1',
    )
  })

  test('去除前后空格', () => {
    expect(normalizeBaseUrl('  https://api.openai.com/v1  ')).toBe(
      'https://api.openai.com/v1',
    )
  })
})
