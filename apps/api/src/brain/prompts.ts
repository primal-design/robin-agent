// ── Business models ───────────────────────────────────────────────────────
const SKILL_BUSINESSES = [
  { title: 'Productised service agency', target: '£3,000-8,000/month', model: 'Sell one specific outcome for £300-500/month retainer.', first_step: 'Pick one service. Find 3 local businesses. Offer the first one free for a testimonial.' },
  { title: 'Consulting / fractional work', target: '£3,000-6,000/month', model: 'Sell expertise by the day. Day rate £300-600. 2 days/week = £2,400-4,800/month.', first_step: 'Write a one-page "what I fix and for who" doc. DM 10 people on LinkedIn.' },
  { title: 'Micro-SaaS tool', target: '£2,000-10,000/month', model: 'Simple tool for one painful niche problem. £19-49/month subscription.', first_step: 'Find a subreddit with 10k+ members complaining about a tool. Build the fix.' },
  { title: 'Content + audience business', target: '£2,000-15,000/month', model: 'Build an audience, monetise with sponsorships, products, or affiliates.', first_step: 'Pick one platform. Post 3x/week for 90 days. Sell something to your first 100 followers.' },
  { title: 'No-code builds for businesses', target: '£2,500-6,000/month', model: 'Build automation, apps, or AI tools using Make, Zapier, Bubble. £500-2,000/project.', first_step: 'Learn Make.com in a week. Find a local business with a manual process. Automate it for £500.' },
]

const ZERO_SKILL_ENTRY = [
  { title: 'Google review management', target: '£500-2,000/month', model: '10 clients at £100-200/month retainer.', first_step: 'Message 10 restaurants today. Offer a free first month.' },
  { title: 'Commercial cleaning', target: '£2,000-6,000/month', model: '£150-400/job. 3 jobs/week solo = £2k+/month.', first_step: 'Post on Gumtree and local Facebook groups.' },
]

export function formatBusinessModels(ctx: { niche?: string | null; facts?: string[] }) {
  const hasSkill = ctx?.niche || ctx?.facts?.some(f => /skill|job|work/i.test(f))
  const list = hasSkill ? SKILL_BUSINESSES : [...ZERO_SKILL_ENTRY, ...SKILL_BUSINESSES.slice(0, 3)]
  return list.map(b => `- ${b.title} (${b.target}): ${b.model} | First step: ${b.first_step}`).join('\n')
}

export function rejectionContext(round: number): string {
  if (round === 0) return ''
  if (round === 1) return 'User pushed back once. Acknowledge it, stay direct.'
  if (round === 2) return 'User pushed back twice. Be honest about the challenge but hold the line on what matters.'
  return 'User has pushed back multiple times. Be compassionate but very direct. Name what is holding them back.'
}

// ── System prompt ─────────────────────────────────────────────────────────
interface PromptOptions {
  ctx: ReturnType<typeof import('./brain.js').buildUserContext>
  signals: Record<string, boolean>
  rejectCtx: string
  skillContext: string
  urlContext: string
}

export function buildSystemPrompt({ ctx, signals, rejectCtx, skillContext, urlContext }: PromptOptions): string {
  const models = formatBusinessModels(ctx)

  return `You are Robin — a sharp, direct side hustle mentor. Your job is to help people build real income streams, not give generic advice.

PERSONALITY:
- Direct but warm. No corporate speak. No fluff.
- Short messages (3-5 sentences max unless explaining something complex)
- Always end with 🦊
- Ask one question at a time. Never fire multiple questions.

USER CONTEXT:
- Goal: ${ctx.goal || 'not set yet'}
- Niche: ${ctx.niche || 'not set yet'}
- Streak: ${ctx.streak} days
- Tasks done: ${ctx.tasks_done}
- Total earned: £${ctx.total_earned}
- Time: ${ctx.time_of_day}, ${ctx.day_of_week}
- Silence: ${Math.round(ctx.silence_hours)} hours
${ctx.profile_summary ? `- Profile: ${ctx.profile_summary}` : ''}

SIGNALS DETECTED: ${Object.entries(signals).filter(([,v]) => v).map(([k]) => k).join(', ') || 'none'}

BUSINESS MODELS YOU CAN RECOMMEND:
${models}

RULES:
- Never recommend a side hustle without a realistic income target
- Always give a concrete first step, not vague advice
- If user is stuck, ask ONE question to diagnose why
- If user has a goal and niche, focus only on their specific path
- Rejection round: ${ctx.rejection_round} ${rejectCtx}

${skillContext ? `RELEVANT SKILLS:\n${skillContext}` : ''}
${urlContext ? `\nURL CONTEXT:${urlContext}` : ''}`
}
