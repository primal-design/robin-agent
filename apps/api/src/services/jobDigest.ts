import { pool } from '../db/pool.js'
import { sendTelegram, sendTelegramWithButtons } from '../lib/telegram.js'
import { fetchAllJobs } from './jobFetcher.js'
import { matchJobsForProfile, getTopMatches } from './jobMatcher.js'
import { getProfile } from './profileService.js'
import { maybeStartOnboarding, isProfileComplete } from './telegramOnboarding.js'

// ── Format a single job match for Telegram ────────────────────────────────────

function formatJobCard(
  _index: number,
  match: {
    title:             string
    company:           string | null
    location:          string | null
    salary_min:        number | null
    salary_max:        number | null
    remote_type:       string | null
    url:               string | null
    suitability_score: number
    match_reasons:     string[]
    missing_skills:    string[]
    llm_summary:       string | null
    match_id:          string
  }
): string {
  const salary = match.salary_min || match.salary_max
    ? `£${(match.salary_min ?? 0).toLocaleString()}–${(match.salary_max ?? 0).toLocaleString()}`
    : 'Salary not listed'

  const remote = match.remote_type === 'remote'
    ? ' · 🏠 Remote'
    : match.remote_type === 'hybrid'
    ? ' · 🏢 Hybrid'
    : ''

  const score = match.suitability_score
  const bar   = score >= 80 ? '🟢' : score >= 60 ? '🟡' : '🟠'

  const lines = [
    `<b>${match.title}</b>`,
    `${match.company ?? 'Company not listed'} · ${match.location ?? 'Location not specified'}${remote}`,
    `${salary} · ${bar} ${score}% match`,
  ]

  if (match.llm_summary) {
    lines.push(`<i>${match.llm_summary}</i>`)
  }

  if (match.missing_skills.length) {
    lines.push(`Missing: ${match.missing_skills.slice(0, 3).join(', ')}`)
  }

  if (match.url) {
    lines.push(`<a href="${match.url}">View job</a>`)
  }

  return lines.join('\n')
}

// ── Build and send daily digest for one user ──────────────────────────────────

async function sendDigestToUser(params: {
  tenantId:   string
  chatId:     number
  botToken:   string
}): Promise<void> {
  const { tenantId, chatId, botToken } = params

  const profile = await getProfile(tenantId)

  // If profile is missing key fields, ask the user to fill it in via Telegram
  if (!isProfileComplete(profile)) {
    await maybeStartOnboarding(tenantId, chatId, botToken, profile)
    return
  }

  // profile is complete here
  const p = profile!

  // Run matching for new jobs
  await matchJobsForProfile(tenantId, p.id, p, 300)

  // Get top unsent matches
  const matches = await getTopMatches(tenantId, p.id, 5, 30)
  const unsent  = matches.filter(m => !m.sent_to_telegram)
  console.log(`[jobDigest] tenant ${tenantId}: ${matches.length} total matches, ${unsent.length} unsent, chatId=${chatId}`)

  if (!unsent.length) {
    console.log(`[jobDigest] no unsent matches for tenant ${tenantId}`)
    return
  }

  // Send header
  await sendTelegram(
    chatId,
    `🔍 <b>FEN found ${unsent.length} new job match${unsent.length > 1 ? 'es' : ''} for you today</b>`,
    botToken
  )

  // Send each job as its own message with inline buttons
  const sentIds: string[] = []
  for (const m of unsent) {
    const card = formatJobCard(0, m)  // index unused — standalone card

    // callback_data format: "job:<action>:<match_id>" (max 64 bytes)
    const mid = m.match_id.slice(0, 36)
    const buttons = [[
      { text: '✅ Interested',  callback_data: `job:interested:${mid}` },
      { text: '❌ Skip',        callback_data: `job:skip:${mid}` },
    ], [
      { text: '❓ Why matched', callback_data: `job:why:${mid}` },
    ]]

    await sendTelegramWithButtons(chatId, card, buttons, botToken)
    sentIds.push(m.match_id)

    // Small delay between messages to avoid Telegram rate limits
    await new Promise(r => setTimeout(r, 300))
  }

  // Mark as sent
  if (sentIds.length) {
    await pool.query(
      `UPDATE job_matches SET sent_to_telegram = true WHERE id = ANY($1::uuid[])`,
      [sentIds]
    )
  }
}

// ── Main: run daily digest for all active users with a Telegram channel ───────

export async function runDailyJobDigest(): Promise<void> {
  console.log('[jobDigest] Starting daily job digest...')

  // 1. Fetch fresh jobs from all sources
  try {
    await fetchAllJobs()
  } catch (err) {
    console.error('[jobDigest] Job fetch failed:', err instanceof Error ? err.message : err)
  }

  // 2. Get all users with a Telegram chat linked to their tenant
  // Uses worker_channels to find Telegram channels per tenant
  const usersRes = await pool.query<{
    tenant_id: string
    chat_id:   string
    bot_token: string | null
  }>(
    `SELECT DISTINCT wc.tenant_id,
            (wc.public_config->>'chat_id')::text AS chat_id,
            wc.encrypted_config->>'bot_token' AS bot_token
     FROM worker_channels wc
     WHERE wc.channel_type = 'telegram'
       AND wc.public_config->>'chat_id' IS NOT NULL
       AND wc.status = 'active'`
  )

  const defaultToken = process.env.TELEGRAM_BOT_TOKEN ?? ''

  for (const user of usersRes.rows) {
    const chatId   = parseInt(user.chat_id, 10)
    const botToken = user.bot_token ?? defaultToken

    if (!chatId || !botToken) continue

    try {
      await sendDigestToUser({
        tenantId: user.tenant_id,
        chatId,
        botToken,
      })
    } catch (err) {
      console.error(
        `[jobDigest] Failed for tenant ${user.tenant_id}:`,
        err instanceof Error ? err.message : err
      )
    }
  }

  console.log(`[jobDigest] Digest complete for ${usersRes.rows.length} user(s)`)
}
