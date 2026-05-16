import type { PoolClient } from 'pg'

const COMPLIANCE_COMMANDS = ['/about', '/forget', '/human', '/data', '/start']

export function isComplianceCommand(text: string) {
  return COMPLIANCE_COMMANDS.includes(text.toLowerCase().trim())
}

export async function handleComplianceCommand(
  text: string,
  client: PoolClient,
  conversationId: string,
  tenantId: string
): Promise<string | null> {
  const cmd = text.toLowerCase().trim()

  if (cmd === '/start') {
    const memRes = await client.query(`SELECT value FROM business_memory WHERE key = 'business_name'`)
    const name = memRes.rows[0]?.value ?? 'this business'
    return aboutMessage(name)
  }

  if (cmd === '/about') {
    const memRes = await client.query(
      `SELECT value FROM business_memory WHERE key = 'business_name'`
    )
    const name = memRes.rows[0]?.value ?? 'this business'
    return aboutMessage(name)
  }

  if (cmd === '/forget') {
    return forgetConversation(client, conversationId, tenantId)
  }

  if (cmd === '/human') {
    return (
      `You've requested a human. A team member will pick this up shortly.\n\n` +
      `If urgent, please contact us directly.`
    )
  }

  if (cmd === '/data') {
    return (
      `Your data rights:\n\n` +
      `• We store your conversation messages to provide the service.\n` +
      `• Type /forget to delete this conversation at any time.\n` +
      `• We do not sell your data.\n` +
      `• Data is processed under GDPR.\n\n` +
      `For a full data export or deletion request, contact us.`
    )
  }

  return null
}

// Injected on the very first message (EU AI Act Article 50 disclosure)
export function firstMessageDisclosure(businessName: string) {
  return (
    `👋 Hi! I'm an AI assistant for *${businessName}*, powered by Fen.\n\n` +
    `I can help with questions, qualify your enquiry, and connect you with the team.\n` +
    `A human can take over at any time.\n\n` +
    `Commands:\n` +
    `/about — what I am and who runs me\n` +
    `/human — speak to a person\n` +
    `/forget — delete this conversation\n` +
    `/data — your data rights`
  )
}

function aboutMessage(_businessName: string) {
  return (
    `I'm *FEN* — an AI built to help you think, solve, and move faster in your business.\n\n` +
    `Tell me what you're working on and I'll figure out the best way to help.\n\n` +
    `• I'm an AI, not a human.\n` +
    `• Type /human to speak with a person.\n` +
    `• Type /forget to delete this conversation.\n` +
    `• Type /data to learn how your data is used.`
  )
}

async function forgetConversation(
  client: PoolClient,
  conversationId: string,
  tenantId: string
): Promise<string> {
  await client.query(
    `DELETE FROM messages WHERE conversation_id = $1 AND tenant_id = $2`,
    [conversationId, tenantId]
  )
  await client.query(
    `DELETE FROM conversations WHERE id = $1 AND tenant_id = $2`,
    [conversationId, tenantId]
  )
  return `Your conversation has been deleted. ✓`
}
