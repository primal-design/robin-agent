import { pool } from '../db/pool.js'
import { answerCallbackQuery, editTelegramMessage } from '../lib/telegram.js'
import { tailorForApplication } from './documentTailor.js'
import { notifyTailorReady } from './jobNotifier.js'
import { getProfile } from './profileService.js'

// ── Handle Telegram inline button presses for job matches ─────────────────────
// callback_data format: "job:<action>:<match_id>"

export async function handleJobCallback(params: {
  callbackQueryId: string
  chatId:          number
  messageId:       number
  data:            string
  botToken:        string
}): Promise<void> {
  const { callbackQueryId, chatId, messageId, data, botToken } = params

  const parts = data.split(':')
  if (parts[0] !== 'job' || parts.length < 3) return

  const action  = parts[1]
  const matchId = parts[2]

  // Resolve tenantId from chatId
  const tenantRes = await pool.query<{ tenant_id: string }>(
    `SELECT wc.tenant_id FROM worker_channels wc
     WHERE wc.channel_type = 'telegram'
       AND wc.external_id  = $1
       AND wc.is_active    = true
     LIMIT 1`,
    [String(chatId)]
  )
  const tenantId = tenantRes.rows[0]?.tenant_id
  if (!tenantId) {
    await answerCallbackQuery(callbackQueryId, 'Session not found. Please re-link your account.', botToken)
    return
  }

  // Fetch match
  const matchRes = await pool.query<{
    job_id:            string
    job_title:         string
    job_company:       string | null
    suitability_score: number
    match_reasons:     string[]
    missing_skills:    string[]
    llm_summary:       string | null
  }>(
    `SELECT m.job_id, j.title AS job_title, j.company AS job_company,
            m.suitability_score, m.match_reasons, m.missing_skills, m.llm_summary
     FROM job_matches m
     JOIN jobs j ON j.id = m.job_id
     WHERE m.id = $1 AND m.tenant_id = $2`,
    [matchId, tenantId]
  )
  const match = matchRes.rows[0]
  if (!match) {
    await answerCallbackQuery(callbackQueryId, 'Match not found.', botToken)
    return
  }

  if (action === 'interested') {
    await handleInterested({ tenantId, matchId, match, callbackQueryId, chatId, messageId, botToken })
  } else if (action === 'skip') {
    await handleSkip({ tenantId, matchId, match, callbackQueryId, chatId, messageId, botToken })
  } else if (action === 'why') {
    await handleWhy({ match, callbackQueryId, botToken })
  }
}

// ── Interested ────────────────────────────────────────────────────────────────

async function handleInterested(params: {
  tenantId:        string
  matchId:         string
  match:           { job_id: string; job_title: string; job_company: string | null; suitability_score: number }
  callbackQueryId: string
  chatId:          number
  messageId:       number
  botToken:        string
}): Promise<void> {
  const { tenantId, matchId, match, callbackQueryId, chatId, messageId, botToken } = params

  // Mark match as interested
  await pool.query(
    `UPDATE job_matches SET user_feedback = 'interested' WHERE id = $1 AND tenant_id = $2`,
    [matchId, tenantId]
  )

  // Create or find application
  const profile = await getProfile(tenantId)
  let applicationId: string | null = null

  if (profile) {
    const appRes = await pool.query<{ id: string }>(
      `INSERT INTO applications
         (tenant_id, profile_id, job_id, status, match_score)
       VALUES ($1, $2, $3, 'interested', $4)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [tenantId, profile.id, match.job_id, match.suitability_score]
    )
    // If conflict, fetch existing
    if (appRes.rows[0]) {
      applicationId = appRes.rows[0].id
    } else {
      const existing = await pool.query<{ id: string }>(
        `SELECT id FROM applications WHERE tenant_id=$1 AND job_id=$2 LIMIT 1`,
        [tenantId, match.job_id]
      )
      applicationId = existing.rows[0]?.id ?? null
    }

    await pool.query(
      `INSERT INTO application_events (tenant_id, application_id, event_type)
       VALUES ($1, $2, 'USER_INTERESTED')
       ON CONFLICT DO NOTHING`,
      [tenantId, applicationId]
    )
  }

  // Update the Telegram message to show confirmed state
  await editTelegramMessage(
    chatId, messageId,
    `✅ <b>${match.job_title}</b> @ ${match.job_company ?? 'Unknown'}\n\nAdded to your pipeline. Tailoring your CV now...`,
    botToken
  )
  await answerCallbackQuery(callbackQueryId, 'Added to pipeline!', botToken)

  // Tailor documents in background if we have an application
  if (applicationId && profile?.raw_cv_text) {
    tailorForApplication(tenantId, applicationId)
      .then(() => notifyTailorReady({ tenantId, applicationId: applicationId! }))
      .catch(e => console.error('[jobCallback] Tailor failed:', e.message))
  }
}

// ── Skip ──────────────────────────────────────────────────────────────────────

async function handleSkip(params: {
  tenantId:        string
  matchId:         string
  match:           { job_title: string; job_company: string | null }
  callbackQueryId: string
  chatId:          number
  messageId:       number
  botToken:        string
}): Promise<void> {
  const { tenantId, matchId, match, callbackQueryId, chatId, messageId, botToken } = params

  await pool.query(
    `UPDATE job_matches SET user_feedback = 'skip' WHERE id = $1 AND tenant_id = $2`,
    [matchId, tenantId]
  )

  await editTelegramMessage(
    chatId, messageId,
    `⏭ <s>${match.job_title}</s> @ ${match.job_company ?? 'Unknown'}\n\n<i>Skipped</i>`,
    botToken
  )
  await answerCallbackQuery(callbackQueryId, 'Skipped', botToken)
}

// ── Why matched ───────────────────────────────────────────────────────────────

async function handleWhy(params: {
  match:           { job_title: string; match_reasons: string[]; missing_skills: string[]; llm_summary: string | null }
  callbackQueryId: string
  botToken:        string
}): Promise<void> {
  const { match, callbackQueryId, botToken } = params

  const reasons = match.match_reasons.length
    ? match.match_reasons.map(r => `• ${r}`).join('\n')
    : 'No specific reasons captured.'

  const missing = match.missing_skills.length
    ? `\n\n⚠️ <b>Gaps:</b> ${match.missing_skills.join(', ')}`
    : ''

  const summary = match.llm_summary ? `\n\n<i>${match.llm_summary}</i>` : ''

  const text = `🎯 <b>Why ${match.job_title}?</b>\n\n${reasons}${missing}${summary}`

  await answerCallbackQuery(callbackQueryId, text.slice(0, 200), botToken)
}
