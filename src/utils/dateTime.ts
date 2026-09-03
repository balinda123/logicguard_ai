const SQLITE_UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/

function utcDate(value: string): Date {
  const normalized = SQLITE_UTC_TIMESTAMP.test(value) ? `${value.replace(' ', 'T')}Z` : value
  return new Date(normalized)
}

export function formatChinaDateTime(value: string): string {
  const date = utcDate(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })
}

export function formatChinaTime(value: string): string {
  const date = utcDate(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleTimeString('zh-CN', { hour12: false, timeZone: 'Asia/Shanghai' })
}
