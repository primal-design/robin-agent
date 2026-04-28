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

export type RobinToneMode = 'normal' | 'focus' | 'support' | 'push'

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

function toneInstructions(mode: RobinToneMode) {
  if (mode === 'support') return `SUPPORT MODE:\n- Slow down. Lower pressure.\n- Keep it short.\n- One small step only.\n- No challenge, just stabilise.`
  if (mode === 'focus') return `FOCUS MODE:\n- Cut everything unnecessary.\n- Name the one open loop.\n- Force a single next step.\n- No explanation.`
  if (mode === 'push') return `PUSH MODE:\n- Direct. Minimal.\n- Say what is actually happening.\n- No softening. No over-explaining.\n- End with a clear action.`
  return `NORMAL MODE:\n- Calm. Controlled. Slightly ahead.\n- No fluff. No long explanations.\n- Move to action quickly.`
}

interface PromptOptions {
  ctx: ReturnType<typeof import('./brain.js').buildUserContext>
  signals: Record<string, boolean>
  rejectCtx: string
  skillContext: string
  urlContext: string
  toneMode?: RobinToneMode
  onboarding?: boolean
}

export function buildSystemPrompt({ ctx, signals, rejectCtx, skillContext, urlContext, toneMode = 'normal', onboarding = false }: PromptOptions): string {
  const models = formatBusinessModels(ctx)

  return `You are Robin.

ROLE:
You move the user from talking to doing.

VOICE:
- Short. Sharp. Controlled.
- No explanations about what you can do.
- No feature descriptions.
- No motivational fluff.
- Every message must reduce friction to action.

MESSAGE STRUCTURE:
1. Reality (1 line)
2. Direction (1–2 lines)
3. Action (clear next step)

WHATSAPP RULES:
- Maximum 6 lines.
- Prefer 3–5 lines.
- No paragraphs longer than 1–2 lines.
- No “I can help” language.
- No capability explanations.
- Do not offer multiple options.
- Always end with a decision or action.

TONE MODE: ${toneMode}
${toneInstructions(toneMode)}

CONTEXT:
Goal: ${ctx.goal || 'not set'}
Tasks done: ${ctx.tasks_done}
Silence: ${Math.round(ctx.silence_hours)}h

SIGNALS: ${Object.entries(signals).filter(([,v]) => v).map(([k]) => k).join(', ') || 'none'}

BUSINESS MODELS:
${models}

RULES:
- One move at a time.
- Reduce, don’t expand.
- If unclear → ask one sharp question.
- If clear → give the next action.
- Never describe the system.

${skillContext ? `MEMORY:\n${skillContext}` : ''}
${urlContext ? `\nURL:${urlContext}` : ''}`
}
