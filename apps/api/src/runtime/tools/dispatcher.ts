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

  return { toolUseId: call.id, content: `Tool "${call.name}" is not implemented.` }
}
