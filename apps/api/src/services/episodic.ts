import Anthropic from '@anthropic-ai/sdk'
import type { PoolClient } from 'pg'
import { env } from '../config/env.js'

const anthropic = new Anthropic({ apiKey: env.anthropicKey })

export async function getEpisodicSummary(
  client: PoolClient,
  conversationId: string
): Promise<string> {
  const r = await client.query(
    `SELECT summary FROM conversations WHERE id = $1`, [conversationId]
  )
  return r.rows[0]?.summary ?? ''
}

export async function updateEpisodicSummary(
  client: PoolClient,
  conversationId: string,
  userMessage: string,
  agentReply: string
): Promise<void> {
  try {
    const existing = await getEpisodicSummary(client, conversationId)

    const prompt = existing
      ? `Prior summary: ${existing}\n\nNew exchange:\nUser: ${userMessage}\nAgent: ${agentReply}\n\nUpdate the summary. Keep ALL specific facts — names, dates, places, numbers, preferences. Add any new facts from this exchange. Remove nothing important. 6-8 sentences max. Plain text only.`
      : `User: ${userMessage}\nAgent: ${agentReply}\n\nSummarise this exchange. Capture every specific fact mentioned — names, dates, places, numbers, preferences, decisions. 4-6 sentences. Plain text only.`

    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{ role: 'user', content: prompt }],
    })

    const summary = res.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('')
      .trim()

    await client.query(
      `UPDATE conversations
       SET summary = $1, summary_updated_at = now()
       WHERE id = $2`,
      [summary, conversationId]
    )
  } catch (err) {
    console.error('[episodic] summary update failed:', err instanceof Error ? err.message : err)
  }
}
