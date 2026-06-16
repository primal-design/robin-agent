import { pool } from '../db/pool.js'
import { env } from '../config/env.js'
import { sendTelegramWithButtons, editTelegramMessage, answerCallbackQuery } from '../lib/telegram.js'
import { tailorForApplication } from './documentTailor.js'

// ── Resolve a tenant's Telegram chat ─────────────────────────────────────────

export async function getTenantTelegram(tenantId: string): Promise<{ chatId: number; botToken: string } | null> {
  const r = await pool.query<{ chat_id: string; bot_token: string | null }>(
    `SELECT wc.external_id AS chat_id, wc.config->>'bot_token' AS bot_token
     FROM worker_channels wc
     WHERE wc.tenant_id   = $1
       AND wc.channel_type = 'telegram'
       AND wc.external_id IS NOT NULL
       AND wc.is_active    = true
     LIMIT 1`,
    [tenantId]
  )
  if (!r.rows[0]) return null
  const chatId   = parseInt(r.rows[0].chat_id, 10)
  const botToken = r.rows[0].bot_token ?? env.telegramBotToken
  if (!chatId || !botToken) return null
  return { chatId, botToken }
}

// ── Send tailor-ready notification ────────────────────────────────────────────
// Called after tailorForApplication() completes successfully.

export async function notifyTailorReady(params: {
  tenantId:      string
  applicationId: string
}): Promise<void> {
  const { tenantId, applicationId } = params

  const tg = await getTenantTelegram(tenantId)
  if (!tg) return

  // Fetch application + job + documents
  const r = await pool.query<{
    job_title:   string
    job_company: string | null
    job_url:     string | null
    cv_content:  string
    cl_content:  string
  }>(
    `SELECT j.title AS job_title, j.company AS job_company, j.url AS job_url,
            r.content AS cv_content, cl.content AS cl_content
     FROM applications a
     JOIN jobs          j  ON j.id  = a.job_id
     LEFT JOIN resumes  r  ON r.id  = a.tailored_cv_id
     LEFT JOIN cover_letters cl ON cl.id = a.cover_letter_id
     WHERE a.id = $1 AND a.tenant_id = $2`,
    [applicationId, tenantId]
  )
  if (!r.rows[0]) return

  const { job_title, job_company, cv_content, cl_content, job_url } = r.rows[0]
  const company = job_company ?? 'Unknown company'

  const text = [
    `📄 <b>Your documents are ready!</b>`,
    ``,
    `<b>${job_title}</b> @ ${company}`,
    ``,
    `<b>CV excerpt:</b>`,
    `<i>${(cv_content ?? '').slice(0, 400).trim()}...</i>`,
    ``,
    `<b>Cover letter:</b>`,
    `<i>${(cl_content ?? '').slice(0, 300).trim()}...</i>`,
    ``,
    `Review in full at /app/applications/${applicationId}`,
  ].join('\n')

  const appId = applicationId.slice(0, 36)
  const buttons = [[
    { text: '✅ Approve & Apply', callback_data: `apply:approve:${appId}` },
    { text: '🔄 Regenerate',      callback_data: `apply:regen:${appId}` },
  ]]
  if (job_url) {
    buttons.push([{ text: '🔗 View job posting', callback_data: `apply:viewjob:${appId}` }])
  }

  await sendTelegramWithButtons(tg.chatId, text.slice(0, 4000), buttons, tg.botToken)
}

// ── Handle approval callback queries ─────────────────────────────────────────
// callback_data format: "apply:<action>:<application_id>"

export async function handleApplyCallback(params: {
  callbackQueryId: string
  chatId:          number
  messageId:       number
  data:            string
  tenantId:        string
  botToken:        string
}): Promise<void> {
  const { callbackQueryId, chatId, messageId, data, tenantId, botToken } = params

  const parts = data.split(':')
  const action        = parts[1]
  const applicationId = parts[2]

  if (action === 'approve') {
    await handleApprove({ tenantId, applicationId, callbackQueryId, chatId, messageId, botToken })
  } else if (action === 'regen') {
    await handleRegenerate({ tenantId, applicationId, callbackQueryId, chatId, messageId, botToken })
  } else if (action === 'viewjob') {
    await handleViewJob({ tenantId, applicationId, callbackQueryId, botToken })
  }
}

// ── Approve ───────────────────────────────────────────────────────────────────

async function handleApprove(params: {
  tenantId:        string
  applicationId:   string
  callbackQueryId: string
  chatId:          number
  messageId:       number
  botToken:        string
}): Promise<void> {
  const { tenantId, applicationId, callbackQueryId, chatId, messageId, botToken } = params

  // Fetch job details to decide apply method
  const r = await pool.query<{
    job_title:          string
    job_company:        string | null
    job_url:            string | null
    applying_email:     string | null
    application_method: string | null
  }>(
    `SELECT j.title AS job_title, j.company AS job_company, j.url AS job_url,
            a.applying_email, a.application_method
     FROM applications a
     JOIN jobs j ON j.id = a.job_id
     WHERE a.id = $1 AND a.tenant_id = $2`,
    [applicationId, tenantId]
  )
  if (!r.rows[0]) {
    await answerCallbackQuery(callbackQueryId, 'Application not found.', botToken)
    return
  }

  const { job_title, job_company, job_url, applying_email } = r.rows[0]
  const company = job_company ?? 'Unknown'

  // Mark as approved
  await pool.query(
    `UPDATE applications
     SET status = 'approved', approved_at = now(), last_update_at = now()
     WHERE id = $1 AND tenant_id = $2`,
    [applicationId, tenantId]
  )
  await pool.query(
    `INSERT INTO application_events (tenant_id, application_id, event_type)
     VALUES ($1, $2, 'APPROVED')`,
    [tenantId, applicationId]
  )

  if (applying_email) {
    // Email apply — kick off in background
    applyViaEmail(tenantId, applicationId).catch(e =>
      console.error('[jobNotifier] email apply failed:', e.message)
    )

    await editTelegramMessage(
      chatId, messageId,
      `✅ <b>Approved!</b>\n\n<b>${job_title}</b> @ ${company}\n\nSending your application via email now...`,
      botToken
    )
    await answerCallbackQuery(callbackQueryId, 'Sending application...', botToken)
  } else {
    // Manual apply — send the job URL
    const urlLine = job_url ? `\n\n<a href="${job_url}">Apply here →</a>` : ''
    await editTelegramMessage(
      chatId, messageId,
      `✅ <b>Approved!</b>\n\n<b>${job_title}</b> @ ${company}\n\nYour tailored CV and cover letter are ready. Apply manually:${urlLine}`,
      botToken
    )
    await answerCallbackQuery(callbackQueryId, 'Documents approved!', botToken)
  }
}

// ── Regenerate ────────────────────────────────────────────────────────────────

async function handleRegenerate(params: {
  tenantId:        string
  applicationId:   string
  callbackQueryId: string
  chatId:          number
  messageId:       number
  botToken:        string
}): Promise<void> {
  const { tenantId, applicationId, callbackQueryId, chatId, messageId, botToken } = params

  await editTelegramMessage(
    chatId, messageId,
    `🔄 <b>Regenerating your documents...</b>\n\nThis takes about 30 seconds.`,
    botToken
  )
  await answerCallbackQuery(callbackQueryId, 'Regenerating...', botToken)

  // Reset status and re-tailor
  await pool.query(
    `UPDATE applications SET status = 'drafting', last_update_at = now()
     WHERE id = $1 AND tenant_id = $2`,
    [applicationId, tenantId]
  )

  tailorForApplication(tenantId, applicationId)
    .then(() => notifyTailorReady({ tenantId, applicationId }))
    .catch(e => console.error('[jobNotifier] regen failed:', e.message))
}

// ── View job ──────────────────────────────────────────────────────────────────

async function handleViewJob(params: {
  tenantId:        string
  applicationId:   string
  callbackQueryId: string
  botToken:        string
}): Promise<void> {
  const { tenantId, applicationId, callbackQueryId, botToken } = params

  const r = await pool.query<{ job_url: string | null }>(
    `SELECT j.url AS job_url FROM applications a JOIN jobs j ON j.id = a.job_id
     WHERE a.id = $1 AND a.tenant_id = $2`,
    [applicationId, tenantId]
  )
  const url = r.rows[0]?.job_url ?? ''
  await answerCallbackQuery(callbackQueryId, url ? `Job URL: ${url}` : 'No URL available.', botToken)
}

// ── Email apply ───────────────────────────────────────────────────────────────

async function applyViaEmail(tenantId: string, applicationId: string): Promise<void> {
  const r = await pool.query<{
    applying_email:  string | null
    job_title:       string
    job_company:     string | null
    cv_content:      string | null
    cl_content:      string | null
    applicant_name:  string | null
  }>(
    `SELECT a.applying_email, j.title AS job_title, j.company AS job_company,
            res.content AS cv_content, cl.content AS cl_content,
            p.full_name AS applicant_name
     FROM applications a
     JOIN jobs           j   ON j.id   = a.job_id
     JOIN user_profiles  p   ON p.id   = a.profile_id
     LEFT JOIN resumes   res ON res.id = a.tailored_cv_id
     LEFT JOIN cover_letters cl ON cl.id = a.cover_letter_id
     WHERE a.id = $1 AND a.tenant_id = $2`,
    [applicationId, tenantId]
  )
  const row = r.rows[0]
  if (!row?.applying_email || !row.cl_content) {
    console.warn(`[jobNotifier] applyViaEmail: missing email or cover letter for ${applicationId}`)
    return
  }

  // Find Gmail connector for tenant
  const connRes = await pool.query<{ email_address: string; oauth_tokens: Record<string, string> }>(
    `SELECT email_address, oauth_tokens FROM email_connections
     WHERE tenant_id = $1 AND provider = 'gmail' AND status = 'connected'
     LIMIT 1`,
    [tenantId]
  )
  if (!connRes.rows[0]) {
    console.warn(`[jobNotifier] No Gmail connection for tenant ${tenantId} — cannot email apply`)
    return
  }

  const subject = `Application: ${row.job_title}${row.job_company ? ` at ${row.job_company}` : ''}`
  const body = [
    row.cl_content,
    '',
    '---',
    row.cv_content ?? '',
  ].join('\n')

  // Send via Gmail API
  const { sendEmail } = await import('../lib/gmail.js')
  await sendEmail(connRes.rows[0].oauth_tokens, {
    to:      row.applying_email,
    subject,
    body,
  })

  // Mark as applied
  await pool.query(
    `UPDATE applications
     SET status = 'applied', applied_at = now(), last_update_at = now()
     WHERE id = $1 AND tenant_id = $2`,
    [applicationId, tenantId]
  )
  await pool.query(
    `INSERT INTO application_events (tenant_id, application_id, event_type)
     VALUES ($1, $2, 'APPLIED')`,
    [tenantId, applicationId]
  )

  // Notify user
  const tg = await getTenantTelegram(tenantId)
  if (tg) {
    await sendTelegramWithButtons(
      tg.chatId,
      `🚀 <b>Application sent!</b>\n\n<b>${row.job_title}</b>${row.job_company ? ` @ ${row.job_company}` : ''}\n\nEmailed to ${row.applying_email}. FEN will notify you of any replies.`,
      [[{ text: '📋 View pipeline', callback_data: 'nav:pipeline' }]],
      tg.botToken
    )
  }

  console.log(`[jobNotifier] Applied to ${row.applying_email} for application ${applicationId}`)
}
