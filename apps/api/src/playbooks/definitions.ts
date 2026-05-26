export interface IntakeQuestion {
  key:       string
  question:  string
  type:      'text' | 'number' | 'select'
  options?:  string[]
  required:  boolean
}

export interface ScheduledJobDef {
  name:          string
  task:          string
  defaultCron:   string
  executionMode: 'agent_only' | 'script_plus_agent'
  outputChannel: 'telegram' | 'none'
}

export interface PlaybookDefinition {
  id:             string
  name:           string
  icon:           string
  description:    string
  category:       'travel' | 'productivity' | 'sales' | 'finance' | 'communication'
  needs:          string[]          // human-readable requirements
  connectors:     string[]          // 'gmail' | 'hubspot' | 'slack' etc
  memoryKeys:     { key: string; description: string }[]
  intake:         IntakeQuestion[]
  outputContract: string[]
  scheduledJobs?: ScheduledJobDef[]
  approvalRequired: boolean
  exampleOutput:  string
}

export const PLAYBOOKS: PlaybookDefinition[] = [
  // ── 1. Trip Planner ────────────────────────────────────────────────────────
  {
    id:          'trip_planner',
    name:        'Trip Planner',
    icon:        '✈️',
    description: 'Plan a personalised trip from chat. Fen builds your itinerary, packing list, booking checklist, and sets reminders.',
    category:    'travel',
    needs:       ['Destination, dates, and budget'],
    connectors:  [],
    memoryKeys: [
      { key: 'travel_destination',   description: 'Where you are going' },
      { key: 'travel_dates',         description: 'Departure and return dates' },
      { key: 'travel_budget',        description: 'Total trip budget' },
      { key: 'travel_style',         description: 'Rest or adventure, solo or group' },
      { key: 'travel_companions',    description: 'Who is travelling' },
      { key: 'dietary_preferences',  description: 'Food preferences and restrictions' },
      { key: 'pace_preferences',     description: 'Busy or relaxed travel pace' },
    ],
    intake: [
      { key: 'destination',   question: 'Where are you going?',                                                      type: 'text',   required: true },
      { key: 'dates',         question: 'What are your travel dates? (e.g. 10–17 June)',                              type: 'text',   required: true },
      { key: 'budget',        question: 'What is your total budget for the trip?',                                    type: 'text',   required: true },
      { key: 'companions',    question: 'Who is travelling with you? (solo, partner, family, friends)',               type: 'text',   required: true },
      { key: 'style',         question: 'Rest and relax, or packed with activities?',                                 type: 'select', options: ['Relaxed', 'Balanced', 'Packed'], required: true },
      { key: 'dietary',       question: 'Any food preferences or dietary requirements?',                              type: 'text',   required: false },
    ],
    outputContract: ['Day-by-day itinerary', 'Packing list', 'Booking checklist', 'Budget breakdown', 'Pre-trip reminders'],
    scheduledJobs: [
      {
        name:          'Pre-trip reminder (7 days)',
        task:          'Send a 7-day pre-trip reminder based on travel_destination, travel_dates, and travel_budget. Include key things still to book or prepare.',
        defaultCron:   '0 9 * * *',
        executionMode: 'agent_only',
        outputChannel: 'telegram',
      },
    ],
    approvalRequired: false,
    exampleOutput:    'Day 1 — Arrive Lisbon. Check in Hotel Bairro Alto. Evening: Alfama walking tour.\nDay 2 — Sintra day trip...',
  },

  // ── 2. Inbox Briefing ──────────────────────────────────────────────────────
  {
    id:          'inbox_briefing',
    name:        'Inbox Briefing',
    icon:        '📬',
    description: 'Every morning Fen reads your inbox and sends you a clear briefing — urgent items, drafts needed, and who you are waiting on.',
    category:    'productivity',
    needs:       ['Gmail connected'],
    connectors:  ['gmail'],
    memoryKeys: [
      { key: 'inbox_rules',        description: 'Your rules for what counts as urgent' },
      { key: 'important_contacts', description: 'People whose emails always matter' },
      { key: 'tone_of_voice',      description: 'How you write emails' },
      { key: 'approval_rules',     description: 'Emails Fen should never reply to without you' },
    ],
    intake: [
      { key: 'send_time',          question: 'What time should Fen send your daily briefing? (e.g. 8:00am)',         type: 'text',   required: true },
      { key: 'important_contacts', question: 'Who should always be flagged as important? (names or email addresses)', type: 'text',   required: false },
      { key: 'urgent_keywords',    question: 'Any keywords that make an email urgent? (e.g. invoice, contract, urgent)', type: 'text', required: false },
      { key: 'tone',               question: 'How do you write emails? (formal, casual, brief)',                     type: 'text',   required: false },
    ],
    outputContract: ['Urgent emails needing action', 'Drafts Fen has prepared', 'Emails you are waiting on', 'Low-priority summary'],
    scheduledJobs: [
      {
        name:          'Daily inbox briefing',
        task:          'Read the inbox using Gmail connector. Summarise: (1) urgent items needing action today, (2) emails waiting on a reply from others, (3) low-priority FYI. Use inbox_rules and important_contacts memory to prioritise.',
        defaultCron:   '0 8 * * 1-5',
        executionMode: 'script_plus_agent',
        outputChannel: 'telegram',
      },
    ],
    approvalRequired: true,
    exampleOutput:    '📬 Morning briefing — 3 urgent, 2 drafts ready\n\n🔴 Urgent\n• James — Invoice overdue (reply needed)\n• Sarah — Contract question...',
  },

  // ── 3. Meeting Brief ───────────────────────────────────────────────────────
  {
    id:          'meeting_brief',
    name:        'Meeting Brief',
    icon:        '🗓️',
    description: 'Before any important meeting, Fen sends a brief — who you are meeting, what to prepare, and what you want to achieve.',
    category:    'productivity',
    needs:       ['Meeting details (name, company, context)'],
    connectors:  ['hubspot'],
    memoryKeys: [
      { key: 'meeting_prep_style',  description: 'How detailed you want your briefs' },
      { key: 'meeting_goals',       description: 'Default goals for client meetings' },
      { key: 'company_context',     description: 'Your company background for introductions' },
    ],
    intake: [
      { key: 'prep_style',    question: 'How detailed do you want meeting briefs? (bullet points, full paragraphs)',  type: 'select', options: ['Bullet points', 'Full paragraphs', 'One paragraph'], required: true },
      { key: 'default_goal',  question: 'What is your default goal for most meetings? (e.g. close, qualify, review)', type: 'text',   required: false },
      { key: 'company_intro', question: 'How would you describe your company in one sentence?',                       type: 'text',   required: false },
    ],
    outputContract: ['Who you are meeting and their background', 'What to prepare', 'Key questions to ask', 'What you want to achieve', 'Notes from last interaction'],
    approvalRequired: false,
    exampleOutput:   '📋 Meeting brief — James Chen, Acme Corp\n\nGoal: Close the Q2 contract\nBackground: Series B, 45 staff...',
  },

  // ── 4. Invoice Follow-up ──────────────────────────────────────────────────
  {
    id:          'invoice_followup',
    name:        'Invoice Follow-up',
    icon:        '💰',
    description: 'Fen tracks overdue invoices and drafts polite follow-up messages for you to approve before sending.',
    category:    'finance',
    needs:       ['Invoice details (client name, amount, due date)'],
    connectors:  [],
    memoryKeys: [
      { key: 'invoice_tone',         description: 'How you like to follow up — firm or polite' },
      { key: 'payment_terms',        description: 'Your standard payment terms' },
      { key: 'followup_intervals',   description: 'When to follow up — 3 days, 7 days, 14 days' },
    ],
    intake: [
      { key: 'tone',       question: 'How do you prefer to follow up on invoices?',                type: 'select', options: ['Very polite', 'Firm but friendly', 'Direct'], required: true },
      { key: 'terms',      question: 'What are your standard payment terms? (e.g. 30 days)',       type: 'text',   required: true },
      { key: 'intervals',  question: 'When should Fen remind you? (e.g. 3 days, 7 days overdue)', type: 'text',   required: false },
    ],
    outputContract: ['Draft follow-up message', 'Invoice status summary', 'Next action recommendation'],
    scheduledJobs: [
      {
        name:          'Weekly invoice check',
        task:          'Check for any outstanding invoices mentioned in memory. For each overdue invoice, draft a follow-up using invoice_tone and payment_terms. Always require approval before sending.',
        defaultCron:   '0 9 * * 1',
        executionMode: 'agent_only',
        outputChannel: 'telegram',
      },
    ],
    approvalRequired: true,
    exampleOutput:   'Hi James, just a friendly reminder that invoice #1042 for £1,200 was due on 15 May...',
  },

  // ── 5. Sales Follow-up ────────────────────────────────────────────────────
  {
    id:          'sales_followup',
    name:        'Sales Follow-up',
    icon:        '🤝',
    description: 'Never lose a lead. Fen tracks your pipeline and drafts timely follow-up messages when prospects go quiet.',
    category:    'sales',
    needs:       ['Lead and prospect details'],
    connectors:  ['hubspot'],
    memoryKeys: [
      { key: 'sales_tone',         description: 'How you communicate with prospects' },
      { key: 'followup_cadence',   description: 'How often to follow up' },
      { key: 'pipeline_stage',     description: 'Current pipeline stages and statuses' },
      { key: 'value_proposition',  description: 'Your core offer in one sentence' },
    ],
    intake: [
      { key: 'tone',       question: 'How do you like to follow up with prospects?',                type: 'select', options: ['Consultative', 'Direct', 'Casual'], required: true },
      { key: 'cadence',    question: 'How many days of silence before Fen flags a lead?',          type: 'number', required: true },
      { key: 'value_prop', question: 'What is the one thing you help clients with most?',          type: 'text',   required: true },
    ],
    outputContract: ['List of leads to follow up', 'Draft message per lead', 'Recommended next action'],
    scheduledJobs: [
      {
        name:          'Weekly pipeline review',
        task:          'Review the sales pipeline using HubSpot data and pipeline_stage memory. Flag any leads that have gone quiet based on followup_cadence. Draft follow-up messages using sales_tone and value_proposition.',
        defaultCron:   '0 8 * * 1',
        executionMode: 'script_plus_agent',
        outputChannel: 'telegram',
      },
    ],
    approvalRequired: true,
    exampleOutput:   '🤝 3 leads to follow up\n\n1. Sarah at TechCorp — 8 days quiet. Draft: "Hi Sarah, just checking in..."',
  },

  // ── 6. Founder Weekly Brief ───────────────────────────────────────────────
  {
    id:          'founder_weekly',
    name:        'Founder Weekly Brief',
    icon:        '📊',
    description: 'Every Monday morning Fen sends you a clear picture of the week — what moved, what is stuck, and what matters most.',
    category:    'productivity',
    needs:       ['Business goals and priorities stored in memory'],
    connectors:  [],
    memoryKeys: [
      { key: 'weekly_priorities',  description: 'Top 3 things that matter this week' },
      { key: 'business_goals',     description: 'Your current quarterly goals' },
      { key: 'kpis',               description: 'Key numbers you track weekly' },
      { key: 'open_decisions',     description: 'Decisions you are sitting on' },
    ],
    intake: [
      { key: 'goals',       question: 'What are your top 1–3 goals for this quarter?',               type: 'text',   required: true },
      { key: 'kpis',        question: 'What numbers do you track weekly? (e.g. revenue, leads, MRR)', type: 'text',   required: false },
      { key: 'send_time',   question: 'What time on Monday should Fen send your weekly brief?',       type: 'text',   required: true },
    ],
    outputContract: ['What moved this week', 'What is stuck', 'Top 3 priorities this week', 'Open decisions to make', 'One thing to focus on today'],
    scheduledJobs: [
      {
        name:          'Monday founder brief',
        task:          'Generate a founder weekly brief using business_goals, weekly_priorities, kpis, and open_decisions memory. Format: what moved, what is stuck, top 3 priorities, open decisions. Keep it sharp and under 200 words.',
        defaultCron:   '0 8 * * 1',
        executionMode: 'agent_only',
        outputChannel: 'telegram',
      },
    ],
    approvalRequired: false,
    exampleOutput:   '📊 Week of 26 May\n\nMoved: Closed Acme deal, onboarded 2 clients\nStuck: Pricing page rewrite, hire decision\nThis week: Ship v2, close 1 more...',
  },

  // ── 7. Open Loop Tracker ──────────────────────────────────────────────────
  {
    id:          'open_loop_tracker',
    name:        'Open Loop Tracker',
    icon:        '🔁',
    description: 'Nothing slips through. Fen tracks things you are waiting on and nudges you when they go quiet.',
    category:    'productivity',
    needs:       ['Things you are waiting on (Fen learns these from conversation)'],
    connectors:  [],
    memoryKeys: [
      { key: 'open_loops',         description: 'Things waiting on a response or action' },
      { key: 'loop_check_cadence', description: 'How often to review open loops' },
    ],
    intake: [
      { key: 'cadence',    question: 'How often should Fen review your open loops?',               type: 'select', options: ['Daily', 'Every 2 days', 'Weekly'], required: true },
      { key: 'threshold',  question: 'How many days before Fen flags something as overdue?',       type: 'number', required: true },
    ],
    outputContract: ['List of open loops', 'What is overdue', 'Suggested nudges or actions'],
    scheduledJobs: [
      {
        name:          'Open loop review',
        task:          'Review open_loops memory. Flag anything overdue based on loop_check_cadence. Suggest what to chase, close, or drop. Keep it brief.',
        defaultCron:   '0 9 * * 1,3,5',
        executionMode: 'agent_only',
        outputChannel: 'telegram',
      },
    ],
    approvalRequired: false,
    exampleOutput:   '🔁 4 open loops\n\n🔴 Overdue (7+ days)\n• James — proposal feedback\n• Bank — account setup\n\n🟡 Waiting...',
  },
]

export function getPlaybook(id: string): PlaybookDefinition | undefined {
  return PLAYBOOKS.find(p => p.id === id)
}
