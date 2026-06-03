import type { PoolClient } from 'pg'
import { webSearch } from './web_search.js'

export interface ToolCall {
  id:    string
  name:  string
  input: Record<string, unknown>
}

export interface ToolResult {
  toolUseId: string
  content:   string
}

export async function dispatchTool(
  client: PoolClient,
  tenantId: string,
  conversationId: string,
  call: ToolCall
): Promise<ToolResult> {
  if (call.name === 'web_search') {
    const query = String(call.input.query ?? '').trim()
    if (!query) return { toolUseId: call.id, content: 'No query provided.' }

    try {
      const results = await webSearch(query)

      // Store citations — fire and forget, never crash main flow
      for (const r of results) {
        client.query(
          `INSERT INTO citations (tenant_id, conversation_id, tool_id, title, url, snippet)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [tenantId, conversationId, 'web_search', r.title, r.url, r.snippet]
        ).catch((e) => console.error('[citations] insert failed:', e.message))
      }

      if (results.length === 0) return { toolUseId: call.id, content: 'No results found.' }

      const content = results
        .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.snippet}`)
        .join('\n\n')

      return { toolUseId: call.id, content }
    } catch (err) {
      console.error('[web_search] tool error:', (err as Error).message)
      return { toolUseId: call.id, content: `Search unavailable: ${(err as Error).message}. Answer from your own knowledge instead.` }
    }
  }

  if (call.name === 'create_reminder') {
    const message  = String(call.input.message  ?? '').trim()
    const remindAt = String(call.input.remind_at ?? '').trim()

    if (!message)  return { toolUseId: call.id, content: 'Reminder message is required.' }
    if (!remindAt) return { toolUseId: call.id, content: 'remind_at datetime is required.' }

    const remindDate = new Date(remindAt)
    if (isNaN(remindDate.getTime())) {
      return { toolUseId: call.id, content: `Invalid datetime: "${remindAt}". Use ISO 8601 format, e.g. 2026-06-05T09:00:00.` }
    }
    if (remindDate <= new Date()) {
      return { toolUseId: call.id, content: 'remind_at must be in the future.' }
    }

    // Get chat_id and channel_id from conversation
    const convRes = await client.query(
      `SELECT external_user_id, channel_id FROM conversations WHERE id = $1`,
      [conversationId]
    )
    const chatId    = Number(convRes.rows[0]?.external_user_id ?? 0)
    const channelId = convRes.rows[0]?.channel_id ?? null

    if (!chatId) return { toolUseId: call.id, content: 'Could not determine chat destination for this conversation.' }

    await client.query(
      `INSERT INTO reminders (tenant_id, conversation_id, chat_id, channel_id, message, remind_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [tenantId, conversationId, chatId, channelId, message, remindDate]
    )

    const formatted = remindDate.toLocaleString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/London',
    })
    return { toolUseId: call.id, content: `Reminder set for ${formatted}.` }
  }

  return { toolUseId: call.id, content: `Tool "${call.name}" is not implemented.` }
}
