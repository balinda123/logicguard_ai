import { invoke } from '@tauri-apps/api/core'

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
