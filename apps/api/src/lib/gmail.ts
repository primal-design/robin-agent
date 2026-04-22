import { google } from 'googleapis'
import { env } from '../config/env.js'

function makeOAuth2() {
  return new google.auth.OAuth2(
    env.gmailClientId,
    env.gmailClientSecret,
    env.gmailRedirectUri
  )
}

export function getAuthUrl(state: string) {
  const client = makeOAuth2()
  return client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    state,
    scope: [
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/contacts.readonly',
    ]
  })
}

export async function exchangeCode(code: string) {
  const client = makeOAuth2()
  const { tokens } = await client.getToken(code)
  return tokens
}

function gmailClient(tokens: any) {
  const auth = makeOAuth2()
  auth.setCredentials(tokens)
  return google.gmail({ version: 'v1', auth })
}

export async function listEmails(tokens: any, { query = '', maxResults = 15, unreadOnly = false } = {}) {
  const gmail = gmailClient(tokens)
  const q = [query, unreadOnly ? 'is:unread' : ''].filter(Boolean).join(' ')
  const list = await gmail.users.messages.list({ userId: 'me', q, maxResults, labelIds: ['INBOX'] })
  if (!list.data.messages?.length) return []

  const msgs = await Promise.all(
    list.data.messages.map((m: any) =>
      gmail.users.messages.get({ userId: 'me', id: m.id!, format: 'metadata', metadataHeaders: ['From', 'To', 'Subject', 'Date'] })
    )
  )
  return msgs.map((e: any) => {
    const h = e.data.payload.headers
    const get = (n: string) => h.find((x: any) => x.name === n)?.value || ''
    return {
      id:       e.data.id,
      threadId: e.data.threadId,
      from:     get('From'),
      subject:  get('Subject'),
      date:     get('Date'),
      snippet:  e.data.snippet,
      unread:   e.data.labelIds?.includes('UNREAD') ?? false,
    }
  })
}

export async function getEmailBody(tokens: any, messageId: string) {
  const gmail = gmailClient(tokens)
  const msg   = await gmail.users.messages.get({ userId: 'me', id: messageId, format: 'full' })
  function extract(payload: any): string {
    if (payload.mimeType === 'text/plain' && payload.body?.data)
      return Buffer.from(payload.body.data, 'base64').toString('utf-8').trim()
    if (payload.parts) {
      for (const p of payload.parts) { const t = extract(p); if (t) return t }
    }
    return ''
  }
  return extract(msg.data.payload)
}

export async function sendEmail(tokens: any, { to, subject, body, threadId }: { to: string, subject: string, body: string, threadId?: string }) {
  const gmail   = gmailClient(tokens)
  const profile = await gmail.users.getProfile({ userId: 'me' })
  const from    = profile.data.emailAddress
  let raw = `From: ${from}\nTo: ${to}\nSubject: ${subject}\nContent-Type: text/plain; charset=utf-8\n\n${body}`
  const encoded = Buffer.from(raw).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encoded, ...(threadId ? { threadId } : {}) } })
}

export async function getEmailProfile(tokens: any) {
  const gmail = gmailClient(tokens)
  const p = await gmail.users.getProfile({ userId: 'me' })
  return { email: p.data.emailAddress, total: p.data.messagesTotal }
}
