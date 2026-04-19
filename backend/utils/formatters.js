/**
 * Output formatters
 */

export function formatCurrency(amount, currency = '£') {
  return `${currency}${Number(amount || 0).toFixed(2)}`
}

export function formatRelativeTime(isoString) {
  if (!isoString) return 'never'
  const diff = Date.now() - new Date(isoString).getTime()
  const mins  = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days  = Math.floor(diff / 86_400_000)
  if (mins < 1)   return 'just now'
  if (mins < 60)  return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  return `${days}d ago`
}

export function truncate(str, len = 100) {
  if (!str) return ''
  return str.length > len ? str.slice(0, len) + '…' : str
}
