import { invoke } from '@tauri-apps/api/core'
import { getLlmConfig } from './llmBridge'

const DEFAULT_CDP_PORT = 9222

function browserStorageKey(): string {
  return `logicguard_browser_config_${sessionStorage.getItem('logicguard_user_id') ?? 'anonymous'}`
}

export function getCdpPort(): number {
  const stored = Number(localStorage.getItem(browserStorageKey()))
  return Number.isInteger(stored) && stored > 0 && stored <= 65535 ? stored : DEFAULT_CDP_PORT
}

export function setCdpPort(port: number): void {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error('INVALID_CDP_PORT')
  localStorage.setItem(browserStorageKey(), String(port))
}

export async function checkBrowserConnection(): Promise<boolean> {
  return invoke<boolean>('browser_check_connection', { port: getCdpPort() }).catch(() => false)
}

export interface CapturedRequirementPage {
  url: string
  title: string
  content: string
  totalChars: number
  filteredChars: number
  keyword: string | null
  paragraphCount: number
  matchedKeywords?: string[]
  unmatchedKeywords?: string[]
  usedFullTextFallback?: boolean
  usedAccessibilityFallback?: boolean
  usedAiMatch?: boolean
  aiMatchMethod?: 'accessibility' | 'vision'
}

export async function captureRequirementPage(
  url: string,
  keyword?: string,
  options: { aiMatch?: boolean } = {},
): Promise<CapturedRequirementPage> {
  const aiMatch = options.aiMatch === true
  // 只有用户显式开启 AI 匹配才传当前非敏感模型配置；API Key 始终由 Rust 从当前用户凭据库注入。
  return invoke<CapturedRequirementPage>('capture_requirement_page', {
    input: {
      url,
      keyword: keyword?.trim() || null,
      port: getCdpPort(),
      aiMatch,
      model: aiMatch ? getLlmConfig() : null,
    },
  })
}
