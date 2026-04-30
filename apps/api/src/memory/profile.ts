/**
 * GDPR-compliant user profile
 * Built entirely from what the user voluntarily shares in conversation.
 * Stored inside the session JSON — deleting the session deletes the profile.
 */

export interface UserProfile {
  // From signup form
  name?:          string
  signup_reason?: string   // "For productivity", "Running a business" etc

  // From onboarding questions
  main_goal?:     string   // what they want off their plate
  work_style?:    string   // solo / team / client-facing / freelance etc
  peak_time?:     string   // morning / evening / flexible

  // Inferred passively from conversation — only user-shared data
  topics?:        string[] // recurring subjects they bring up
  style_notes?:   string[] // communication preferences Robin noticed
  wins?:          string[] // things they've completed or celebrated
  avoid?:         string[] // things they asked Robin not to do

  // Housekeeping
  onboarding_step?:      number   // 0 = not started, 1-3 = in progress, 4 = done
  onboarding_completed?: boolean
  created_at?:           string
  updated_at?:           string
}

export function getProfile(session: any): UserProfile {
  return session.user_profile || {}
}

export function setProfile(session: any, profile: UserProfile) {
  session.user_profile = {
    ...profile,
    updated_at: new Date().toISOString(),
  }
}

/** Seed the profile from the waitlist signup data */
export function seedProfileFromSignup(session: any, name: string, signupReason?: string) {
  const profile = getProfile(session)
  if (!profile.created_at) {
    setProfile(session, {
      ...profile,
      name:          name || profile.name,
      signup_reason: signupReason || profile.signup_reason,
      created_at:    new Date().toISOString(),
      onboarding_step: 0,
    })
  }
}

/** Pick the right first question based on why they signed up */
export function onboardingQuestion(step: number, profile: UserProfile): string {
  const reason = (profile.signup_reason || '').toLowerCase()

  if (step === 1) {
    if (reason.includes('business') || reason.includes('owner')) {
      return `What's the one thing your business needs most right now — more clients, less admin, or something else?`
    }
    if (reason.includes('developer')) {
      return `What kind of projects are you working on — and what slows you down most?`
    }
    if (reason.includes('productivity') || reason.includes('work')) {
      return `What's one thing you keep putting off that Robin could take off your plate?`
    }
    if (reason.includes('learn')) {
      return `What are you trying to learn or get better at right now?`
    }
    return `What's one thing you want Robin to help you with most?`
  }

  if (step === 2) {
    return `How do you work — on your own, with a team, or do you deal with clients?`
  }

  if (step === 3) {
    return `Last one — are you more of a morning person or do you get going later in the day?`
  }

  return ''
}

/** Parse the user's answer to each onboarding question into the profile */
export function applyOnboardingAnswer(profile: UserProfile, step: number, answer: string): UserProfile {
  const updated = { ...profile }

  if (step === 1) updated.main_goal  = answer.trim().slice(0, 200)
  if (step === 2) updated.work_style = answer.trim().slice(0, 100)
  if (step === 3) updated.peak_time  = answer.trim().slice(0, 50)

  updated.onboarding_step = step + 1
  if (step >= 3) updated.onboarding_completed = true

  return updated
}

/** Build the profile context string injected into every system prompt */
export function buildProfileContext(profile: UserProfile): string {
  if (!profile || Object.keys(profile).length === 0) return ''

  const lines: string[] = ['USER PROFILE (built from their own words — use this to personalise every response):']

  if (profile.name)          lines.push(`Name: ${profile.name}`)
  if (profile.signup_reason) lines.push(`Signed up because: ${profile.signup_reason}`)
  if (profile.main_goal)     lines.push(`Main goal: ${profile.main_goal}`)
  if (profile.work_style)    lines.push(`Works: ${profile.work_style}`)
  if (profile.peak_time)     lines.push(`Peak time: ${profile.peak_time}`)
  if (profile.topics?.length)      lines.push(`Recurring topics: ${profile.topics.slice(-5).join(', ')}`)
  if (profile.style_notes?.length) lines.push(`Communication style notes: ${profile.style_notes.slice(-3).join('; ')}`)
  if (profile.wins?.length)        lines.push(`Recent wins: ${profile.wins.slice(-2).join('; ')}`)
  if (profile.avoid?.length)       lines.push(`User has asked Robin NOT to: ${profile.avoid.join('; ')}`)

  return lines.join('\n')
}

/** Passive inference — call after every exchange to silently update the profile */
export function inferFromMessage(profile: UserProfile, userMessage: string): UserProfile {
  const updated = { ...profile }
  const msg = userMessage.toLowerCase()

  // Track recurring topics
  const topicHints: Record<string, string> = {
    'email|inbox|gmail':           'email management',
    'client|customer|prospect':    'client work',
    'invoice|payment|money|earn':  'finances',
    'meeting|call|zoom':           'meetings',
    'social|post|content|linkedin|twitter|instagram': 'content creation',
    'code|build|deploy|bug|app':   'software development',
    'write|draft|copy|blog|article': 'writing',
    'learn|study|course|book':     'learning',
    'team|colleague|manager|boss': 'team/work dynamics',
  }

  for (const [pattern, topic] of Object.entries(topicHints)) {
    if (new RegExp(pattern).test(msg)) {
      updated.topics = updated.topics || []
      if (!updated.topics.includes(topic)) {
        updated.topics = [...updated.topics, topic].slice(-8)
      }
    }
  }

  // Communication style preferences
  if (/keep it short|brief|tldr|no fluff|be direct/i.test(userMessage)) {
    updated.style_notes = updated.style_notes || []
    if (!updated.style_notes.includes('prefers short, direct responses')) {
      updated.style_notes = [...updated.style_notes, 'prefers short, direct responses'].slice(-5)
    }
  }
  if (/explain|more detail|why|how does|walk me through/i.test(userMessage)) {
    updated.style_notes = updated.style_notes || []
    if (!updated.style_notes.includes('appreciates detailed explanations')) {
      updated.style_notes = [...updated.style_notes, 'appreciates detailed explanations'].slice(-5)
    }
  }

  // Wins
  if (/done|finished|sent|completed|closed|got it|signed|launched|shipped/i.test(userMessage)) {
    updated.wins = updated.wins || []
    updated.wins = [...updated.wins, userMessage.slice(0, 120)].slice(-5)
  }

  // Avoid list
  if (/don't|do not|stop|never|please don't|please stop/i.test(userMessage)) {
    updated.avoid = updated.avoid || []
    const note = userMessage.slice(0, 80)
    if (!updated.avoid.includes(note)) {
      updated.avoid = [...updated.avoid, note].slice(-5)
    }
  }

  updated.updated_at = new Date().toISOString()
  return updated
}

/** Check if message is a GDPR request */
export function detectGdprRequest(message: string): 'view' | 'delete' | null {
  const msg = message.toLowerCase()
  if (/what do you know about me|my data|my profile|what have you stored|show me what you know/i.test(msg)) return 'view'
  if (/delete (my|all) (data|history|everything|memory)|forget (everything|me|all)|wipe (my|all)|remove my data|right to erasure/i.test(msg)) return 'delete'
  return null
}

/** Format profile for user to read (GDPR transparency) */
export function formatProfileForUser(profile: UserProfile): string {
  const lines = ['Here\'s everything I know about you — built only from our conversations:\n']

  if (profile.name)          lines.push(`• Name: ${profile.name}`)
  if (profile.signup_reason) lines.push(`• You signed up because: ${profile.signup_reason}`)
  if (profile.main_goal)     lines.push(`• Your main goal: ${profile.main_goal}`)
  if (profile.work_style)    lines.push(`• How you work: ${profile.work_style}`)
  if (profile.peak_time)     lines.push(`• Active time: ${profile.peak_time}`)
  if (profile.topics?.length)      lines.push(`• Topics you care about: ${profile.topics.join(', ')}`)
  if (profile.style_notes?.length) lines.push(`• Your preferences: ${profile.style_notes.join('; ')}`)
  if (profile.wins?.length)        lines.push(`• Recent wins I noted: ${profile.wins.join('; ')}`)
  if (profile.avoid?.length)       lines.push(`• Things you've asked me not to do: ${profile.avoid.join('; ')}`)

  lines.push('\nTo delete all of this, say "delete my data".')
  return lines.join('\n')
}
