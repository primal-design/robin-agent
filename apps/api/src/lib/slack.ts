import { env } from '../config/env.js'

const API = 'https://slack.com/api'

// ── Auth URL ──────────────────────────────────────────────────────────────────

export function getSlackAuthUrl(state: string, redirectUri: string): string {
  const url = new URL('https://slack.com/oauth/v2/authorize')
  url.searchParams.set('client_id',    env.slackClientId)
  url.searchParams.set('scope',        'channels:read,channels:history,users:read')
  url.searchParams.set('redirect_uri', redirectUri)
  url.searchParams.set('state',        state)
  return url.toString()
}

// ── Code exchange ─────────────────────────────────────────────────────────────

export interface SlackTokenResult {
  access_token: string    // xoxb-... bot token (does not expire)
  team_id:      string
  team_name:    string
  bot_user_id:  string
}

export async function exchangeSlackCode(
  code: string,
  redirectUri: string
): Promise<SlackTokenResult> {
  const r = await fetch(`${API}/oauth.v2.access`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id:     env.slackClientId,
      client_secret: env.slackClientSecret,
      code,
      redirect_uri:  redirectUri,
    }),
  })
  const data = await r.json() as any
  if (!data.ok) throw new Error(`Slack OAuth error: ${data.error}`)
  return {
    access_token: data.access_token,
    team_id:      data.team?.id ?? '',
    team_name:    data.team?.name ?? '',
    bot_user_id:  data.bot_user_id ?? '',
  }
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function slackGet<T = any>(token: string, method: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${API}/${method}`)
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
  const r = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  })
  const data = await r.json() as any
  if (!data.ok) throw new Error(`Slack ${method}: ${data.error}`)
  return data as T
}

// ── Channel listing ───────────────────────────────────────────────────────────

export interface SlackChannel {
  id:          string
  name:        string
  num_members: number
  topic:       string
  purpose:     string
}

export async function listPublicChannels(token: string, limit = 10): Promise<SlackChannel[]> {
  const data = await slackGet(token, 'conversations.list', {
    types:             'public_channel',
    exclude_archived:  'true',
    limit:             String(Math.min(limit, 200)),
  })
  const channels: SlackChannel[] = (data.channels ?? []).map((c: any) => ({
    id:          c.id          ?? '',
    name:        c.name        ?? '',
    num_members: c.num_members ?? 0,
    topic:       c.topic?.value   ?? '',
    purpose:     c.purpose?.value ?? '',
  }))
  // Sort by member count descending — most active channels first
  return channels.sort((a, b) => b.num_members - a.num_members).slice(0, limit)
}

// ── Message history ───────────────────────────────────────────────────────────

export interface SlackMessage {
  ts:       string   // Unix timestamp string
  text:     string
  user:     string   // user_id, may be empty for bots
  username: string   // display name if available
  subtype?: string   // 'bot_message', 'channel_join', etc. — skip non-human
}

export async function getChannelHistory(
  token:     string,
  channelId: string,
  oldestTs:  string,   // Unix timestamp string (oldest message to include)
  limit = 100
): Promise<SlackMessage[]> {
  try {
    const data = await slackGet(token, 'conversations.history', {
      channel: channelId,
      oldest:  oldestTs,
      limit:   String(limit),
    })
    return (data.messages ?? [])
      .filter((m: any) => !m.subtype || m.subtype === 'bot_message')  // skip joins/leaves
      .map((m: any) => ({
        ts:       m.ts        ?? '',
        text:     m.text      ?? '',
        user:     m.user      ?? '',
        username: m.username  ?? '',
        subtype:  m.subtype,
      }))
  } catch (err: any) {
    // channel not joined, etc — skip gracefully
    if (err?.message?.includes('not_in_channel') || err?.message?.includes('channel_not_found')) {
      return []
    }
    throw err
  }
}

// ── User display name lookup (best-effort; skip on error) ────────────────────

const _userCache = new Map<string, string>()

export async function resolveDisplayName(token: string, userId: string): Promise<string> {
  if (!userId) return ''
  if (_userCache.has(userId)) return _userCache.get(userId)!
  try {
    const data = await slackGet(token, 'users.info', { user: userId })
    const name = data.user?.profile?.display_name || data.user?.real_name || data.user?.name || userId
    _userCache.set(userId, name)
    return name
  } catch {
    return userId
  }
}

// ── ISO week key ──────────────────────────────────────────────────────────────

export function isoWeekKey(date: Date): string {
  // Returns YYYY-WW string for the given date
  const tmp = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  tmp.setUTCDate(tmp.getUTCDate() + 4 - (tmp.getUTCDay() || 7))
  const year = tmp.getUTCFullYear()
  const week = Math.ceil((((tmp.getTime() - Date.UTC(year, 0, 1)) / 86400000) + 1) / 7)
  return `${year}-W${String(week).padStart(2, '0')}`
}
