import type { PoolClient } from 'pg'

export interface Goal {
  id:              string
  title:           string
  description:     string | null
  status:          string
  progress:        string | null
}

export async function getActiveGoal(
  client: PoolClient,
  conversationId: string
): Promise<Goal | null> {
  const r = await client.query(
    `SELECT id, title, description, status, progress
     FROM goals
     WHERE conversation_id = $1 AND status = 'active'
     ORDER BY created_at DESC LIMIT 1`,
    [conversationId]
  )
  return r.rows[0] ?? null
}

export async function updateGoalProgress(
  client: PoolClient,
  goalId: string,
  progress: string
): Promise<void> {
  await client.query(
    `UPDATE goals SET progress = $1, updated_at = now() WHERE id = $2`,
    [progress, goalId]
  )
}

export async function completeGoal(
  client: PoolClient,
  goalId: string,
  summary: string
): Promise<void> {
  await client.query(
    `UPDATE goals
     SET status = 'completed', progress = $1, updated_at = now(), completed_at = now()
     WHERE id = $2`,
    [summary, goalId]
  )
}

// Format active goal for prompt injection
export function formatGoalForPrompt(goal: Goal): string {
  const lines = [`Active goal: ${goal.title}`]
  if (goal.description) lines.push(`Description: ${goal.description}`)
  if (goal.progress)    lines.push(`Progress so far: ${goal.progress}`)
  lines.push(`Status: ${goal.status}`)
  lines.push(`\nAfter your response, if you have made progress toward this goal write: GOAL_PROGRESS: <brief progress note>`)
  lines.push(`If the goal is fully complete write: GOAL_COMPLETE: <completion summary>`)
  return lines.join('\n')
}
