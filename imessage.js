#!/usr/bin/env node
/**
 * Robin iMessage Bridge
 *
 * Runs on your Mac. Watches the Messages database for new texts,
 * forwards them to your Robin server, sends Robin's reply back via iMessage.
 *
 * SETUP (one time):
 *   1. npm run imessage              — starts the bridge
 *   2. Go to System Settings → Privacy & Security → Full Disk Access
 *      → add Terminal (or iTerm2 / VS Code if you run it from there)
 *   3. Anyone who texts your number gets a reply from Robin
 *
 * ENV VARS:
 *   ROBIN_URL  — default: http://localhost:3000
 *                set to your Render URL for 24/7 (e.g. https://robin-agent.onrender.com)
 */

import { execSync, exec } from 'child_process'
import fetch from 'node-fetch'

const ROBIN_URL = process.env.ROBIN_URL || 'http://localhost:3000'
const POLL_MS   = 3000
const DB_PATH   = `${process.env.HOME}/Library/Messages/chat.db`

// ── Check sqlite3 is available ────────────────────────────────────────────
try { execSync('which sqlite3', { stdio: 'ignore' }) }
catch { console.error('sqlite3 not found — install Xcode command line tools: xcode-select --install'); process.exit(1) }

// ── Get last rowid seen ───────────────────────────────────────────────────
function queryDB(sql) {
  try {
    const out = execSync(
      `sqlite3 -json -readonly "${DB_PATH}" "${sql.replace(/"/g, '\\"')}"`,
      { stdio: ['pipe', 'pipe', 'ignore'] }
    ).toString().trim()
    return out ? JSON.parse(out) : []
  } catch { return [] }
}

let lastRowid = (() => {
  const rows = queryDB('SELECT MAX(ROWID) as r FROM message')
  return rows[0]?.r || 0
})()

const sessions    = {}  // sender → sessionId
const newSenders  = new Set()  // track first-time messagers

// ── Poll for new messages ─────────────────────────────────────────────────
function poll() {
  const rows = queryDB(`
    SELECT m.ROWID, m.text, h.id AS sender
    FROM message m
    JOIN handle h ON m.handle_id = h.ROWID
    WHERE m.ROWID > ${lastRowid}
      AND m.is_from_me = 0
      AND m.text IS NOT NULL
      AND length(m.text) > 0
    ORDER BY m.ROWID ASC
    LIMIT 20
  `)

  for (const row of rows) {
    lastRowid = row.ROWID
    handleMessage(row.sender, row.text)
  }
}

// ── Route message to Robin ────────────────────────────────────────────────
async function handleMessage(sender, text) {
  console.log(`[in]  ${sender}: ${text}`)

  const isNew = !sessions[sender]
  if (isNew) {
    sessions[sender] = 'imsg-' + sender.replace(/[^a-z0-9]/gi, '').slice(0, 20)
  }

  try {
    // First-time sender — introduce Robin before replying
    if (isNew && !newSenders.has(sender)) {
      newSenders.add(sender)
      sendIMessage(sender, "Hey — save this number as Robin 🦊 so you know it's me")
      await new Promise(r => setTimeout(r, 1500))
    }

    const res = await fetch(`${ROBIN_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text, sessionId: sessions[sender] })
    })
    const data = await res.json()
    const reply = data.reply || 'Something went wrong 🦊'
    console.log(`[out] → ${sender}: ${reply.slice(0, 80)}...`)
    sendIMessage(sender, reply)
  } catch (e) {
    console.error('Robin error:', e.message)
    sendIMessage(sender, "Robin's offline — try the web app 🦊")
  }
}

// ── Send via AppleScript ──────────────────────────────────────────────────
function sendIMessage(recipient, message) {
  // Escape for AppleScript string
  const safe = message
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\r?\n/g, '\\n')

  const script = [
    'tell application "Messages"',
    '  set s to 1st service whose service type = iMessage',
    `  set b to buddy "${recipient}" of s`,
    `  send "${safe}" to b`,
    'end tell'
  ].join('\n')

  exec(`osascript << 'APPLESCRIPT'\n${script}\nAPPLESCRIPT`, (err) => {
    if (err) console.error('Send failed for', recipient, '—', err.message.split('\n')[0])
  })
}

// ── Start ─────────────────────────────────────────────────────────────────
console.log(`
🦊 Robin iMessage Bridge
   DB:     ${DB_PATH}
   Robin:  ${ROBIN_URL}
   Poll:   every ${POLL_MS / 1000}s

   If nothing happens:
   → System Settings → Privacy → Full Disk Access → add Terminal

   Press Ctrl+C to stop.
`)

setInterval(poll, POLL_MS)
