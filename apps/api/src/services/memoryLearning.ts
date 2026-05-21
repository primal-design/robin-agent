import type { PoolClient } from 'pg'

export interface MemoryProposal {
  targetLayer:        'core' | 'search'
  proposedScope:      string
  proposedMemoryKey:  string
  proposedMemoryValue: unknown
  proposedContent?:   string
  reason:             string
  riskLevel:          'low' | 'medium' | 'high'
}

// ── Propose a memory candidate ────────────────────────────────────────────────
// Called fire-and-forget from agent turns. Never throws — learning failures
// must never crash the main agent flow.
export async function proposeMemoryCandidate(
  client:    PoolClient,
  tenantId:  string,
  proposal:  MemoryProposal,
  sourceRef?: string
): Promise<string | null> {
  try {
    const requiresApproval = proposal.riskLevel !== 'low'

    const r = await client.query<{ id: string }>(
      `INSERT INTO business_memory_candidates
         (tenant_id, target_layer, proposed_scope, proposed_memory_key,
          proposed_memory_value, proposed_content, source_type, source_ref,
          reason, risk_level, requires_approval)
       VALUES ($1,$2,$3,$4,$5,$6,'agent',$7,$8,$9,$10)
       RETURNING id`,
      [
        tenantId,
        proposal.targetLayer,
        proposal.proposedScope,
        proposal.proposedMemoryKey,
        JSON.stringify(proposal.proposedMemoryValue ?? {}),
        proposal.proposedContent ?? null,
        sourceRef ?? null,
        proposal.reason,
        proposal.riskLevel,
        requiresApproval,
      ]
    )

    const candidateId = r.rows[0].id

    // Log memory event
    await client.query(
      `INSERT INTO business_memory_events
         (tenant_id, memory_layer, candidate_id, action, after_value, reason, actor_type)
       VALUES ($1,'candidate',$2,'created',$3,$4,'agent')`,
      [
        tenantId,
        candidateId,
        JSON.stringify({ key: proposal.proposedMemoryKey, value: proposal.proposedMemoryValue }),
        proposal.reason,
      ]
    )

    // Auto-scan and promote low-risk candidates immediately
    if (proposal.riskLevel === 'low') {
      await scanAndPromote(client, tenantId, candidateId, proposal)
    }

    return candidateId
  } catch (err) {
    console.error('[memory] proposeCandidate failed:', err instanceof Error ? err.message : err)
    return null
  }
}

// ── Security scan + auto-promote low-risk candidates ─────────────────────────
async function scanAndPromote(
  client:      PoolClient,
  tenantId:    string,
  candidateId: string,
  proposal:    MemoryProposal
): Promise<void> {
  const risks = runSecurityScan(proposal.proposedMemoryKey, String(proposal.proposedMemoryValue ?? ''))

  if (risks.length > 0) {
    // Flag — do not promote
    await client.query(
      `INSERT INTO business_memory_security_reviews
         (tenant_id, candidate_id, status, risk_reasons, scanned_at)
       VALUES ($1,$2,'flagged',$3,now())`,
      [tenantId, candidateId, JSON.stringify(risks)]
    )
    await client.query(
      `UPDATE business_memory_candidates SET status='rejected', updated_at=now() WHERE id=$1`,
      [candidateId]
    )
    await client.query(
      `INSERT INTO business_memory_events
         (tenant_id, memory_layer, candidate_id, action, reason, actor_type)
       VALUES ($1,'candidate',$2,'security_flagged',$3,'system')`,
      [tenantId, candidateId, risks.join('; ')]
    )
    return
  }

  // Passed — create security review record
  await client.query(
    `INSERT INTO business_memory_security_reviews
       (tenant_id, candidate_id, status, risk_reasons, scanned_at)
     VALUES ($1,$2,'passed','[]',now())`,
    [tenantId, candidateId]
  )
  await client.query(
    `INSERT INTO business_memory_events
       (tenant_id, memory_layer, candidate_id, action, reason, actor_type)
     VALUES ($1,'candidate',$2,'security_passed','auto scan low-risk','system')`,
    [tenantId, candidateId]
  )

  // Promote to business_memory_core
  if (proposal.targetLayer === 'core') {
    const existing = await client.query<{ id: string; memory_value: unknown }>(
      `SELECT id, memory_value FROM business_memory_core
       WHERE tenant_id=$1 AND memory_key=$2 AND owner_user_id IS NULL LIMIT 1`,
      [tenantId, proposal.proposedMemoryKey]
    )

    if (existing.rows[0]) {
      await client.query(
        `UPDATE business_memory_core
         SET memory_value=$1, source_type='agent', updated_at=now()
         WHERE id=$2`,
        [JSON.stringify(proposal.proposedMemoryValue), existing.rows[0].id]
      )
      await client.query(
        `INSERT INTO business_memory_events
           (tenant_id, memory_layer, core_memory_id, candidate_id, action,
            before_value, after_value, reason, actor_type)
         VALUES ($1,'core',$2,$3,'updated',$4,$5,$6,'agent')`,
        [
          tenantId,
          existing.rows[0].id,
          candidateId,
          JSON.stringify(existing.rows[0].memory_value),
          JSON.stringify(proposal.proposedMemoryValue),
          proposal.reason,
        ]
      )
    } else {
      const newCore = await client.query<{ id: string }>(
        `INSERT INTO business_memory_core
           (tenant_id, memory_key, memory_value, source_type, status, security_status)
         VALUES ($1,$2,$3,'agent','active','approved')
         RETURNING id`,
        [tenantId, proposal.proposedMemoryKey, JSON.stringify(proposal.proposedMemoryValue)]
      )
      await client.query(
        `INSERT INTO business_memory_events
           (tenant_id, memory_layer, core_memory_id, candidate_id, action,
            after_value, reason, actor_type)
         VALUES ($1,'core',$2,$3,'created',$4,$5,'agent')`,
        [
          tenantId,
          newCore.rows[0].id,
          candidateId,
          JSON.stringify(proposal.proposedMemoryValue),
          proposal.reason,
        ]
      )
    }

    await client.query(
      `UPDATE business_memory_candidates
       SET status='promoted', updated_at=now() WHERE id=$1`,
      [candidateId]
    )
    await client.query(
      `INSERT INTO business_memory_events
         (tenant_id, memory_layer, candidate_id, action, reason, actor_type)
       VALUES ($1,'candidate',$2,'promoted','auto promoted low-risk','system')`,
      [tenantId, candidateId]
    )
  }
}

// ── Lightweight security scanner ──────────────────────────────────────────────
// Checks for common prompt injection and instruction override patterns.
function runSecurityScan(key: string, value: string): string[] {
  const risks: string[] = []
  const combined = `${key} ${value}`.toLowerCase()

  const patterns: [RegExp, string][] = [
    [/ignore (previous|all|above|prior) instructions?/i, 'prompt_injection'],
    [/you are now|act as|pretend (you are|to be)/i,      'instruction_override'],
    [/system prompt|<\|.*\|>/i,                           'system_prompt_injection'],
    [/exfiltrat|send (all|the) (data|memory|context)/i,  'data_exfiltration'],
    [/bypass (approval|review|security|policy)/i,         'approval_bypass'],
    [/(eval|exec|require|import)\s*\(/i,                  'code_injection'],
    [/https?:\/\/(?![\w-]+\.(com|co\.uk|org|io))/i,      'suspicious_url'],
  ]

  for (const [pattern, risk] of patterns) {
    if (pattern.test(combined)) risks.push(risk)
  }

  return risks
}

// ── Manual approval (dashboard use) ──────────────────────────────────────────
export async function approveCandidate(
  client:      PoolClient,
  tenantId:    string,
  candidateId: string,
  reviewerUserId?: string
): Promise<void> {
  const r = await client.query<{ proposed_memory_key: string; proposed_memory_value: unknown; target_layer: string }>(
    `UPDATE business_memory_candidates
     SET status='approved', reviewed_at=now(), reviewed_by_user_id=$1, updated_at=now()
     WHERE id=$2 AND tenant_id=$3
     RETURNING proposed_memory_key, proposed_memory_value, target_layer`,
    [reviewerUserId ?? null, candidateId, tenantId]
  )
  if (!r.rows[0]) return

  const { proposed_memory_key, proposed_memory_value, target_layer } = r.rows[0]

  if (target_layer === 'core') {
    await client.query(
      `INSERT INTO business_memory_core
         (tenant_id, memory_key, memory_value, source_type, status, security_status)
       VALUES ($1,$2,$3,'agent','active','approved')
       ON CONFLICT (tenant_id, owner_user_id, memory_key)
       DO UPDATE SET memory_value=$3, source_type='agent', updated_at=now()`,
      [tenantId, proposed_memory_key, JSON.stringify(proposed_memory_value)]
    )
  }

  await client.query(
    `INSERT INTO business_memory_events
       (tenant_id, memory_layer, candidate_id, action, after_value, reason, actor_type, actor_user_id)
     VALUES ($1,'candidate',$2,'promoted',$3,'manual approval','user',$4)`,
    [tenantId, candidateId, JSON.stringify(proposed_memory_value), reviewerUserId ?? null]
  )
}

export async function rejectCandidate(
  client:      PoolClient,
  tenantId:    string,
  candidateId: string,
  reviewerUserId?: string
): Promise<void> {
  await client.query(
    `UPDATE business_memory_candidates
     SET status='rejected', reviewed_at=now(), reviewed_by_user_id=$1, updated_at=now()
     WHERE id=$2 AND tenant_id=$3`,
    [reviewerUserId ?? null, candidateId, tenantId]
  )
  await client.query(
    `INSERT INTO business_memory_events
       (tenant_id, memory_layer, candidate_id, action, reason, actor_type, actor_user_id)
     VALUES ($1,'candidate',$2,'rejected','manual rejection','user',$3)`,
    [tenantId, candidateId, reviewerUserId ?? null]
  )
}
