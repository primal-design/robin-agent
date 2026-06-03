import type { PoolClient } from 'pg'

export interface ToolManifest {
  id:               string
  name:             string
  description:      string
  side_effect:      string
  personal_data:    boolean
  reversibility:    string
  default_approval: string
}

export async function getAllowedTools(
  client: PoolClient,
  workerId: string
): Promise<ToolManifest[]> {
  const r = await client.query(
    `SELECT t.id, t.name, t.description, t.side_effect,
            t.personal_data, t.reversibility, t.default_approval
     FROM tools t
     JOIN worker_tools wt ON wt.tool_id = t.id
     WHERE wt.worker_id = $1
       AND wt.enabled = true
       AND t.enabled  = true`,
    [workerId]
  )
  return r.rows
}

export function toAnthropicTool(tool: ToolManifest) {
  const schemas: Record<string, { type: 'object'; properties: Record<string, unknown>; required: string[] }> = {
    web_search: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The search query' },
      },
      required: ['query'],
    },
    create_reminder: {
      type: 'object',
      properties: {
        message:   { type: 'string', description: 'What to remind the user about' },
        remind_at: { type: 'string', description: 'Full ISO 8601 datetime for the reminder, e.g. 2026-06-05T09:00:00. Compute this from the current_datetime in your context.' },
      },
      required: ['message', 'remind_at'],
    },
  }

  return {
    name:         tool.id,
    description:  tool.description,
    input_schema: schemas[tool.id] ?? {
      type: 'object' as const,
      properties: { input: { type: 'string', description: 'Tool input' } },
      required: ['input'],
    },
  }
}
