import i18n from 'i18next'

/**
 * 获取当前语言的 locale 字符串
 */
export function getLocale(): string {
  return i18n.language.startsWith('zh') ? 'zh-CN' : 'en-US'
}

/**
 * 格式化日期
 * @param date 日期对象、字符串或时间戳
 * @param options Intl.DateTimeFormatOptions
 */
export function formatDate(
  date: Date | string | number,
  options?: Intl.DateTimeFormatOptions
): string {
  const d = new Date(date)
  const locale = getLocale()

  const defaultOptions: Intl.DateTimeFormatOptions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...options,
  }

  return d.toLocaleDateString(locale, defaultOptions)
}

/**
 * 格式化日期时间
 * @param date 日期对象、字符串或时间戳
 */
export function formatDateTime(date: Date | string | number): string {
  const d = new Date(date)
  const locale = getLocale()

  return d.toLocaleString(locale, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/**
 * 格式化完整日期时间
 * @param date 日期对象、字符串或时间戳
 */
export function formatFullDateTime(date: Date | string | number): string {
  const d = new Date(date)
  const locale = getLocale()

  return d.toLocaleString(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

/**
 * 格式化相对时间
 * @param ts 时间戳（毫秒）
 */
export function formatRelativeTime(ts: number | null): string {
  if (!ts) return '-'

  const diff = Date.now() - ts
  const locale = getLocale()
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })

  if (diff < 60_000) {
    // 小于1分钟
    return rtf.format(0, 'second')
  }
  if (diff < 3600_000) {
    // 小于1小时
    return rtf.format(-Math.floor(diff / 60_000), 'minute')
  }
  if (diff < 86400_000) {
    // 小于1天
    return rtf.format(-Math.floor(diff / 3600_000), 'hour')
  }
  // 大于1天
  return rtf.format(-Math.floor(diff / 86400_000), 'day')
}

/**
 * 格式化数字
 * @param num 数字
 * @param options Intl.NumberFormatOptions
 */
export function formatNumber(
  num: number,
  options?: Intl.NumberFormatOptions
): string {
  const locale = getLocale()
  return num.toLocaleString(locale, options)
}

/**
 * 格式化货币
 * @param amount 金额
 * @param currency 货币代码，默认 CNY
 */
export function formatCurrency(amount: number, currency: string = 'CNY'): string {
  const locale = getLocale()
  return amount.toLocaleString(locale, {
    style: 'currency',
    currency,
  })
}

/**
 * 格式化 Token 数量（带 K/M 后缀）
 * @param n Token 数量
 */
export function formatTokens(n?: number | null): string {
  if (n === undefined || n === null) return '-'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 10_000) return `${(n / 1000).toFixed(1)}k`
  return n.toLocaleString()
}
