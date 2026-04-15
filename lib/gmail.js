/**
 * Robin Gmail Integration
 * Read, send, archive emails + search contacts via Gmail/People API
 */

import { google } from 'googleapis'

function makeOAuth2() {
  return new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
    process.env.GMAIL_REDIRECT_URI || 'https://robin-agent.onrender.com/email/callback'
  )
}

export function getAuthUrl() {
  const client = makeOAuth2()
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/contacts.readonly',
    ]
  })
}

export async function exchangeCode(code) {
  const client = makeOAuth2()
  const { tokens } = await client.getToken(code)
  return tokens
}

function gmailClient(tokens) {
  const auth = makeOAuth2()
  auth.setCredentials(tokens)
  return google.gmail({ version: 'v1', auth })
}

function peopleClient(tokens) {
  const auth = makeOAuth2()
  auth.setCredentials(tokens)
  return google.people({ version: 'v1', auth })
}

// ── Read emails ───────────────────────────────────────────────────────────
export async function listEmails(tokens, { query = '', maxResults = 15, unreadOnly = false } = {}) {
  const gmail = gmailClient(tokens)
  const q = [query, unreadOnly ? 'is:unread' : ''].filter(Boolean).join(' ')
  const list = await gmail.users.messages.list({ userId: 'me', q, maxResults, labelIds: ['INBOX'] })
  if (!list.data.messages?.length) return []

  const msgs = await Promise.all(
    list.data.messages.map(m =>
      gmail.users.messages.get({ userId: 'me', id: m.id, format: 'metadata', metadataHeaders: ['From', 'To', 'Subject', 'Date'] })
    )
  )
  return msgs.map(e => {
    const h = e.data.payload.headers
    const get = n => h.find(x => x.name === n)?.value || ''
    return {
      id:      e.data.id,
      threadId: e.data.threadId,
      from:    get('From'),
      to:      get('To'),
      subject: get('Subject'),
      date:    get('Date'),
      snippet: e.data.snippet,
      unread:  e.data.labelIds?.includes('UNREAD') ?? false,
    }
  })
}

export async function getEmailBody(tokens, messageId) {
  const gmail = gmailClient(tokens)
  const msg   = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' })
  function extract(payload) {
    if (payload.mimeType === 'text/plain' && payload.body?.data)
      return Buffer.from(payload.body.data, 'base64').toString('utf-8').trim()
    if (payload.parts) {
      for (const p of payload.parts) { const t = extract(p); if (t) return t }
    }
    return ''
  }
  return extract(msg.data.payload)
}

// ── Send email ────────────────────────────────────────────────────────────
export async function sendEmail(tokens, { to, subject, body, threadId, inReplyTo } = {}) {
  const gmail   = gmailClient(tokens)
  const profile = await gmail.users.getProfile({ userId: 'me' })
  const from    = profile.data.emailAddress

  let raw = `From: ${from}\nTo: ${to}\nSubject: ${subject}\nContent-Type: text/plain; charset=utf-8\n`
  if (inReplyTo) raw += `In-Reply-To: ${inReplyTo}\nReferences: ${inReplyTo}\n`
  raw += `\n${body}`

  const encoded = Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  await gmail.users.messages.send({ userId: 'me', requestBody: { raw, ...(threadId ? { threadId } : {}) } })
}

// ── Archive / clean ───────────────────────────────────────────────────────
export async function archiveEmails(tokens, messageIds) {
  const gmail = gmailClient(tokens)
  await Promise.all(messageIds.map(id =>
    gmail.users.messages.modify({ userId: 'me', id, requestBody: { removeLabelIds: ['INBOX'] } })
  ))
  return messageIds.length
}

export async function markRead(tokens, messageIds) {
  const gmail = gmailClient(tokens)
  await Promise.all(messageIds.map(id =>
    gmail.users.messages.modify({ userId: 'me', id, requestBody: { removeLabelIds: ['UNREAD'] } })
  ))
}

// ── Contacts ──────────────────────────────────────────────────────────────
export async function findContact(tokens, query) {
  const people = peopleClient(tokens)
  const res    = await people.people.searchContacts({ query, readMask: 'names,emailAddresses', pageSize: 5 })
  return (res.data.results || []).map(r => ({
    name:  r.person.names?.[0]?.displayName || '',
    email: r.person.emailAddresses?.[0]?.value || '',
  })).filter(c => c.email)
}

// ── Latest email ID (for polling) ─────────────────────────────────────────
export async function getLatestId(tokens) {
  const gmail = gmailClient(tokens)
  const list  = await gmail.users.messages.list({ userId: 'me', maxResults: 1, labelIds: ['INBOX'] })
  return list.data.messages?.[0]?.id || null
}

export async function getEmailProfile(tokens) {
  const gmail = gmailClient(tokens)
  const p     = await gmail.users.getProfile({ userId: 'me' })
  return { email: p.data.emailAddress, total: p.data.messagesTotal }
}
