export function splitHandoffOrigins(value: string): string[] {
  return value.split(/[\n,;；]+/).map(item => item.trim()).filter(Boolean)
}

export function normalizeHandoffOrigin(value: string): string | undefined {
  const candidate = /^https?:\/\//i.test(value.trim()) ? value.trim() : `https://${value.trim()}`
  try {
    const url = new URL(candidate)
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || /\s/.test(url.host)) return undefined
    return url.origin
  } catch {
    return undefined
  }
}

export function parseHandoffOrigins(value: string): { origins: string[]; invalid?: string } {
  const values = splitHandoffOrigins(value)
  const invalid = values.find(item => !normalizeHandoffOrigin(item))
  const origins = [...new Set(values.map(normalizeHandoffOrigin).filter((item): item is string => Boolean(item)))]
  return { origins, invalid }
}

export function handoffOriginInput(origins: readonly string[]): string {
  return origins.map((value) => {
    try { return new URL(value).host } catch { return value }
  }).join('\n')
}

export function normalizeHandoffOriginInput(value: string): string {
  return splitHandoffOrigins(value).map(item => {
    const origin = normalizeHandoffOrigin(item)
    if (!origin) return item
    return new URL(origin).host
  }).join('\n')
}

export function isHttpUrl(value: string): boolean {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}
