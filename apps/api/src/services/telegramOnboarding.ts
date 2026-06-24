import { pool } from '../db/pool.js'
import { sendTelegram, sendTelegramWithButtons } from '../lib/telegram.js'
import { upsertProfile, getProfile } from './profileService.js'
import type { UserProfile } from './profileService.js'

type OnboardingStep =
  | 'confirm_roles'
  | 'ask_work_auth'
  | 'ask_location'
  | 'confirm_seniority'
  | 'ask_salary'
  | 'ask_notice'
  | 'ask_avoid'
  | 'done'

// ── Profile completeness check ────────────────────────────────────────────────

export function getMissingProfileFields(profile: UserProfile | null): string[] {
  const missing: string[] = []
  if (!profile || !profile.target_roles.length)     missing.push('target_roles')
  if (!profile || !profile.min_salary)              missing.push('min_salary')
  if (!profile || !profile.target_locations.length) missing.push('target_locations')
  return missing
}

export function isProfileComplete(profile: UserProfile | null): boolean {
  return getMissingProfileFields(profile).length === 0
}

// ── Onboarding state ──────────────────────────────────────────────────────────

async function getOnboardingStep(tenantId: string): Promise<OnboardingStep | null> {
  const r = await pool.query<{ step: string | null }>(
    `SELECT public_config->>'onboarding_step' AS step
     FROM worker_channels
     WHERE tenant_id = $1 AND channel_type = 'telegram' LIMIT 1`,
    [tenantId]
  )
  return (r.rows[0]?.step as OnboardingStep) ?? null
}

async function setOnboardingStep(tenantId: string, step: OnboardingStep | null): Promise<void> {
  await pool.query(
    `UPDATE worker_channels
     SET public_config = public_config || $1
     WHERE tenant_id = $2 AND channel_type = 'telegram'`,
    [JSON.stringify({ onboarding_step: step }), tenantId]
  )
}

// ── Send question for each step ───────────────────────────────────────────────

async function sendQuestion(
  step:     OnboardingStep,
  chatId:   number,
  botToken: string,
  profile:  UserProfile | null
): Promise<void> {

  if (step === 'confirm_roles') {
    const inferred = profile?.target_roles?.length
      ? profile.target_roles.slice(0, 3).join(', ')
      : null

    if (inferred) {
      await sendTelegramWithButtons(chatId,
        `👋 <b>Welcome to FEN!</b> I've read your CV.\n\n` +
        `Based on your background, I think you're targeting roles like:\n<b>${inferred}</b>\n\n` +
        `Is that right?`,
        [[
          { text: '✅ Yes, that\'s right', callback_data: 'ob:confirm_roles:yes' },
          { text: '✏️ No, let me correct', callback_data: 'ob:confirm_roles:no' },
        ]],
        botToken)
    } else {
      await sendTelegram(chatId,
        `👋 <b>Welcome to FEN!</b>\n\n<b>What roles are you looking for?</b>\nReply with your target job titles, e.g:\n<i>Recruiter, Talent Acquisition Manager, Resourcer</i>`,
        botToken)
    }
  }

  else if (step === 'ask_work_auth') {
    await sendTelegramWithButtons(chatId,
      `<b>What's your right-to-work status in the UK?</b>\n\nThis helps me find roles that match your situation.`,
      [[
        { text: '🇬🇧 British/Irish or Settled', callback_data: 'ob:work_auth:settled' },
        { text: '✅ Work visa (no sponsorship needed)', callback_data: 'ob:work_auth:visa_no_sponsor' },
      ], [
        { text: '📋 Needs sponsorship', callback_data: 'ob:work_auth:needs_sponsor' },
        { text: '👤 Dependent visa', callback_data: 'ob:work_auth:dependent' },
      ]],
      botToken)
  }

  else if (step === 'ask_location') {
    const loc = profile?.location ? ` I've got you based in <b>${profile.location}</b>.` : ''
    await sendTelegram(chatId,
      `<b>Where do you want to work?</b>${loc}\n\nReply with locations and work preference, e.g:\n<i>London, open to hybrid or remote</i>`,
      botToken)
  }

  else if (step === 'confirm_seniority') {
    const inferred = profile?.seniority
    if (inferred) {
      await sendTelegramWithButtons(chatId,
        `I'd describe you as a <b>${inferred}-level</b> candidate. Is that right?`,
        [[
          { text: '✅ Yes', callback_data: 'ob:seniority:confirm' },
          { text: 'Junior', callback_data: 'ob:seniority:junior' },
          { text: 'Mid', callback_data: 'ob:seniority:mid' },
        ], [
          { text: 'Senior', callback_data: 'ob:seniority:senior' },
          { text: 'Lead', callback_data: 'ob:seniority:lead' },
        ]],
        botToken)
    } else {
      await sendTelegramWithButtons(chatId,
        `<b>How would you describe your seniority level?</b>`,
        [[
          { text: 'Junior', callback_data: 'ob:seniority:junior' },
          { text: 'Mid', callback_data: 'ob:seniority:mid' },
          { text: 'Senior', callback_data: 'ob:seniority:senior' },
          { text: 'Lead', callback_data: 'ob:seniority:lead' },
        ]],
        botToken)
    }
  }

  else if (step === 'ask_salary') {
    await sendTelegram(chatId,
      `<b>What's the minimum salary you'd consider? (£/year)</b>\nReply with a number, e.g:\n<i>35000</i>`,
      botToken)
  }

  else if (step === 'ask_notice') {
    await sendTelegramWithButtons(chatId,
      `<b>What's your notice period / how soon could you start?</b>`,
      [[
        { text: 'Immediately', callback_data: 'ob:notice:immediate' },
        { text: '1 week',      callback_data: 'ob:notice:1week' },
        { text: '1 month',     callback_data: 'ob:notice:1month' },
        { text: '3 months',    callback_data: 'ob:notice:3months' },
      ]],
      botToken)
  }

  else if (step === 'ask_avoid') {
    await sendTelegramWithButtons(chatId,
      `<b>Anything you definitely don't want?</b>\nE.g. no cold-calling roles, no night shifts, no specific industries.`,
      [[
        { text: 'Skip this', callback_data: 'ob:avoid:skip' },
      ]],
      botToken)
  }
}

// ── Start onboarding ──────────────────────────────────────────────────────────

export async function maybeStartOnboarding(
  tenantId: string,
  chatId:   number,
  botToken: string,
  profile:  UserProfile | null
): Promise<boolean> {
  if (isProfileComplete(profile)) return false

  const currentStep = await getOnboardingStep(tenantId)
  if (currentStep && currentStep !== 'done') return true

  await setOnboardingStep(tenantId, 'confirm_roles')
  await sendQuestion('confirm_roles', chatId, botToken, profile)
  return true
}

// ── Start post-CV onboarding (called after CV upload via Telegram connect) ────

export async function startPostCVOnboarding(
  tenantId: string,
  chatId:   number,
  botToken: string
): Promise<void> {
  const profile = await getProfile(tenantId)
  await setOnboardingStep(tenantId, 'confirm_roles')
  await sendQuestion('confirm_roles', chatId, botToken, profile)
}

// ── Handle text replies ───────────────────────────────────────────────────────

export async function handleOnboardingReply(
  tenantId: string,
  chatId:   number,
  text:     string,
  botToken: string
): Promise<boolean> {
  const step = await getOnboardingStep(tenantId)
  if (!step || step === 'done') return false

  const profile = await getProfile(tenantId)

  if (step === 'confirm_roles') {
    // Free-text correction of roles
    const roles = text.split(/[,\n]+/).map(s => s.trim()).filter(Boolean)
    await upsertProfile(tenantId, { target_roles: roles })
    await setOnboardingStep(tenantId, 'ask_work_auth')
    await sendQuestion('ask_work_auth', chatId, botToken, profile)
    return true
  }

  if (step === 'ask_location') {
    const parts = text.split(/[,\n]+/).map(s => s.trim()).filter(Boolean)
    const locations = parts.filter(p => !/remote|hybrid|onsite|office/i.test(p))
    const workTypeMatch = text.match(/remote|hybrid|onsite|office/i)
    const workType = workTypeMatch
      ? workTypeMatch[0].toLowerCase().replace('office', 'onsite')
      : undefined

    await upsertProfile(tenantId, {
      target_locations:    locations.length ? locations : (profile?.target_locations ?? []),
      preferred_work_type: workType,
    })
    await setOnboardingStep(tenantId, 'confirm_seniority')
    await sendQuestion('confirm_seniority', chatId, botToken, await getProfile(tenantId))
    return true
  }

  if (step === 'ask_salary') {
    const salary = parseInt(text.replace(/[^0-9]/g, ''), 10)
    if (!isNaN(salary) && salary > 0) {
      await upsertProfile(tenantId, { min_salary: salary })
      await setOnboardingStep(tenantId, 'ask_notice')
      await sendQuestion('ask_notice', chatId, botToken, profile)
    } else {
      await sendTelegram(chatId, `Please reply with a number, e.g. <b>35000</b>`, botToken)
    }
    return true
  }

  if (step === 'ask_avoid') {
    await upsertProfile(tenantId, { avoid_roles: text.split(/[,\n]+/).map(s => s.trim()).filter(Boolean) })
    await completeOnboarding(tenantId, chatId, botToken)
    return true
  }

  return false
}

// ── Handle button callbacks ───────────────────────────────────────────────────

export async function handleOnboardingCallback(
  tenantId: string,
  chatId:   number,
  data:     string,
  botToken: string
): Promise<boolean> {
  if (!data.startsWith('ob:')) return false

  const [, stepKey, value] = data.split(':')
  const profile = await getProfile(tenantId)

  if (stepKey === 'confirm_roles') {
    if (value === 'yes') {
      await setOnboardingStep(tenantId, 'ask_work_auth')
      await sendQuestion('ask_work_auth', chatId, botToken, profile)
    } else {
      await sendTelegram(chatId,
        `What roles are you looking for? Reply with job titles, e.g:\n<i>Recruiter, Talent Acquisition Manager</i>`,
        botToken)
      // stay on confirm_roles step — next text reply will save
    }
    return true
  }

  if (stepKey === 'work_auth') {
    const labels: Record<string, string> = {
      settled:       'British/Irish or Settled Status',
      visa_no_sponsor: 'Work visa (no sponsorship needed)',
      needs_sponsor: 'Requires sponsorship',
      dependent:     'Dependent visa',
    }
    await upsertProfile(tenantId, { work_authorisation: labels[value] ?? value })
    await setOnboardingStep(tenantId, 'ask_location')
    await sendQuestion('ask_location', chatId, botToken, profile)
    return true
  }

  if (stepKey === 'seniority') {
    const seniority = value === 'confirm' ? (profile?.seniority ?? 'mid') : value
    await upsertProfile(tenantId, { seniority })
    await setOnboardingStep(tenantId, 'ask_salary')
    await sendQuestion('ask_salary', chatId, botToken, profile)
    return true
  }

  if (stepKey === 'notice') {
    const labels: Record<string, string> = {
      immediate: 'Immediately',
      '1week':   '1 week',
      '1month':  '1 month',
      '3months': '3 months',
    }
    await upsertProfile(tenantId, { notice_period: labels[value] ?? value })
    await setOnboardingStep(tenantId, 'ask_avoid')
    await sendQuestion('ask_avoid', chatId, botToken, profile)
    return true
  }

  if (stepKey === 'avoid') {
    if (value !== 'skip') {
      await upsertProfile(tenantId, { avoid_roles: [value] })
    }
    await completeOnboarding(tenantId, chatId, botToken)
    return true
  }

  return false
}

// ── Handle work_type button (legacy) ─────────────────────────────────────────

export async function handleWorkTypeCallback(
  tenantId: string,
  chatId:   number,
  workType: string,
  botToken: string
): Promise<void> {
  await upsertProfile(tenantId, { preferred_work_type: workType })
  await completeOnboarding(tenantId, chatId, botToken)
}

async function completeOnboarding(tenantId: string, chatId: number, botToken: string): Promise<void> {
  await setOnboardingStep(tenantId, 'done')
  await sendTelegram(chatId,
    `✅ <b>Profile complete!</b>\n\nFEN will now find matches tailored to you and send them here every morning.\n\nThe more you use it, the sharper it gets. 🎯`,
    botToken)
}
