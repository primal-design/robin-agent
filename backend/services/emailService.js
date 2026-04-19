/**
 * Email service — Gmail tool handlers + new email polling
 */

import { listEmails, sendEmail, archiveEmails, findContact } from '../lib/gmail.js'
import { buildAction } from '../models/action.js'
import { emailNotifications } from '../routes/email.js'
import { loadUser, loadSession, saveSession } from '../lib/db.js'
import { getLatestId } from '../lib/gmail.js'

// ── Handle email tools from the chat brain ────────────────────────────────
export async function handleEmailTool(name, input, tokens, memory, sessionId) {
  if (name === 'read_emails') {
    try {
      const emails = await listEmails(tokens, { query: input.query || '', maxResults: input.maxResults || 15, unreadOnly: input.unreadOnly })
      if (!emails.length) return 'No emails found matching that query.'
      const formatted = emails.map((e, i) =>
        `${i+1}. ${e.unread ? '🔵 ' : ''}From: ${e.from}\n   Subject: ${e.subject}\n   Date: ${e.date}\n   Preview: ${e.snippet}`
      ).join('\n\n')
      return `Found ${emails.length} email(s):\n\n${formatted}`
    } catch (err) { return `Email read failed: ${err.message}` }
  }

  if (name === 'draft_email') {
    let to = input.to || ''
    if (!to && input.find_contact) {
      try {
        const contacts = await findContact(tokens, input.find_contact)
        if (contacts.length) to = contacts[0].email
      } catch {}
    }
    memory.pending_actions = memory.pending_actions || []
    const emailAction = buildAction('draft_email', { to, subject: input.subject, body: input.body, risk: 'medium' })
    memory.pending_actions.push(emailAction)
    memory.pending_action = emailAction
    const preview = `To: ${to || '(contact not found — please provide email)'}\nSubject: ${input.subject}\n\n${input.body}`
    return `DRAFT READY:\n\n${preview}\n\nAsk user: "Want me to send this?"`
  }

  if (name === 'send_email') {
    try {
      await sendEmail(tokens, { to: input.to, subject: input.subject, body: input.body, threadId: input.threadId })
      const sentId = memory.pending_action?.id
      memory.pending_action = null
      memory.pending_actions = (memory.pending_actions || []).filter(a => a.id !== sentId)
      return `Email sent to ${input.to}. Subject: "${input.subject}"`
    } catch (err) { return `Send failed: ${err.message}` }
  }

  if (name === 'clean_inbox') {
    try {
      const emails = await listEmails(tokens, { query: input.query, maxResults: input.maxResults || 50 })
      if (!emails.length) return 'No emails matched — inbox already clean.'
      await archiveEmails(tokens, emails.map(e => e.id))
      return `Archived ${emails.length} emails matching "${input.query}". Inbox cleaned.`
    } catch (err) { return `Clean failed: ${err.message}` }
  }

  if (name === 'email_summary') {
    try {
      const query  = input.period === 'week' ? 'newer_than:7d' : 'newer_than:1d'
      const emails = await listEmails(tokens, { query, maxResults: 30 })
      if (!emails.length) return `No emails in the last ${input.period === 'week' ? '7 days' : '24 hours'}.`
      const unread  = emails.filter(e => e.unread).length
      const senders = [...new Set(emails.map(e => e.from.replace(/<.*>/, '').trim()))].slice(0, 8)
      const list    = emails.slice(0, 15).map(e => `- ${e.unread ? '🔵 ' : ''}${e.from.replace(/<.*>/, '').trim()}: "${e.subject}" — ${e.snippet?.slice(0, 80)}`)
      return `${input.period === 'week' ? 'This week' : 'Today'}: ${emails.length} emails, ${unread} unread.\nFrom: ${senders.join(', ')}\n\n${list.join('\n')}`
    } catch (err) { return `Summary failed: ${err.message}` }
  }

  return 'Unknown email tool'
}

// ── New email polling job ─────────────────────────────────────────────────
export async function pollNewEmails() {
  if (!process.env.GMAIL_CLIENT_ID) return
  try {
    const user = await loadUser('web-default')
    if (!user?.gmail_tokens) return
    const session  = await loadSession('web-default')
    const lastId   = session.gmail_last_id
    const latestId = await getLatestId(user.gmail_tokens)
    if (latestId && latestId !== lastId) {
      const emails = await listEmails(user.gmail_tokens, { maxResults: 1, unreadOnly: false })
      if (emails.length) {
        const e    = emails[0]
        const from = e.from.replace(/<.*>/, '').trim()
        emailNotifications.set('web-default', {
          message: `📬 New email from **${from}** — "${e.subject || '(no subject)'}" 🦊`,
          at: new Date().toISOString()
        })
        session.gmail_last_id = latestId
        await saveSession('web-default', session)
      }
    }
  } catch {}
}
