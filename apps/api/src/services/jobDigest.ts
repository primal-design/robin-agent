import { pool } from '../db/pool.js'
import { sendTelegram } from '../lib/telegram.js'
import { fetchAllJobs } from './jobFetcher.js'
import { matchJobsForProfile, getTopMatches } from './jobMatcher.js'
import { getProfile } from './profileService.js'

// ── Format a single job match for Telegram ────────────────────────────────────

function formatJobCard(
  index: number,
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
    `<b>${index}. ${match.title}</b>`,
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
  if (!profile || !profile.raw_cv_text) {
    await sendTelegram(chatId,
      `👋 <b>FEN Job Agent</b>\n\nUpload your CV to start receiving job matches.\n\nVisit your profile at /app/profile`,
      botToken
    )
    return
  }

  // Run matching for new jobs
  await matchJobsForProfile(tenantId, profile.id, profile, 300)

  // Get top unsent matches
  const matches = await getTopMatches(tenantId, profile.id, 5, 50)
  const unsent  = matches.filter(m => !m.sent_to_telegram)

  if (!unsent.length) {
    // No new matches today
    return
  }

  // Build message
  const header = `🔍 <b>FEN found ${unsent.length} new job match${unsent.length > 1 ? 'es' : ''} for you</b>\n`
  const cards  = unsent.map((m, i) => formatJobCard(i + 1, m)).join('\n\n──────\n\n')
  const footer = `\nReply with the job number to apply, or skip. View all at /app/matches`

  const message = `${header}\n${cards}\n${footer}`

  // Telegram messages max 4096 chars — truncate if needed
  await sendTelegram(chatId, message.slice(0, 4000), botToken)

  // Mark matches as sent
  const sentIds = unsent.map(m => m.match_id)
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
    `SELECT DISTINCT wc.tenant_id, wc.external_id AS chat_id,
            wc.config->>'bot_token' AS bot_token
     FROM worker_channels wc
     WHERE wc.channel_type = 'telegram'
       AND wc.external_id IS NOT NULL
       AND wc.is_active = true`
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
