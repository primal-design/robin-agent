import { pool } from '../db/pool.js'
import { sendTelegram, sendTelegramWithButtons } from '../lib/telegram.js'
import { upsertProfile, getProfile } from './profileService.js'
import type { UserProfile } from './profileService.js'

// Onboarding steps in order
type OnboardingStep = 'ask_roles' | 'ask_skills' | 'ask_salary' | 'ask_location' | 'ask_work_type' | 'done'

const STEP_ORDER: OnboardingStep[] = ['ask_roles', 'ask_skills', 'ask_salary', 'ask_location', 'ask_work_type', 'done']

// ── Profile completeness check ────────────────────────────────────────────────

export function getMissingProfileFields(profile: UserProfile | null): string[] {
  const missing: string[] = []
  if (!profile || !profile.target_roles.length)     missing.push('target_roles')
  if (!profile || !profile.skills.length)           missing.push('skills')
  if (!profile || !profile.min_salary)              missing.push('min_salary')
  if (!profile || !profile.target_locations.length) missing.push('target_locations')
  return missing
}

export function isProfileComplete(profile: UserProfile | null): boolean {
  return getMissingProfileFields(profile).length === 0
}

// ── Onboarding state stored in worker_channels.public_config ─────────────────

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

// ── Send the question for a given step ───────────────────────────────────────

async function sendQuestion(step: OnboardingStep, chatId: number, botToken: string): Promise<void> {
  if (step === 'ask_roles') {
    await sendTelegram(chatId,
      `👋 <b>Let's set up your job search profile so FEN can find the right matches.</b>\n\n` +
      `<b>Step 1/4: What roles are you looking for?</b>\n` +
      `Reply with your target job titles, e.g:\n<i>Senior Software Engineer, Tech Lead, Staff Engineer</i>`,
      botToken)
  } else if (step === 'ask_skills') {
    await sendTelegram(chatId,
      `<b>Step 2/4: What are your top skills?</b>\n` +
      `Reply with a comma-separated list, e.g:\n<i>TypeScript, React, Node.js, PostgreSQL, AWS</i>`,
      botToken)
  } else if (step === 'ask_salary') {
    await sendTelegram(chatId,
      `<b>Step 3/4: What's your minimum acceptable salary? (£/year)</b>\n` +
      `Reply with a number, e.g:\n<i>70000</i>`,
      botToken)
  } else if (step === 'ask_location') {
    await sendTelegram(chatId,
      `<b>Step 4/4: Where do you want to work?</b>\n` +
      `Reply with locations, e.g:\n<i>London, Remote</i>`,
      botToken)
  } else if (step === 'ask_work_type') {
    await sendTelegramWithButtons(chatId,
      `<b>Last one: What's your preferred work type?</b>`,
      [[
        { text: '🏠 Remote',  callback_data: 'profile:work_type:remote' },
        { text: '🏢 Hybrid',  callback_data: 'profile:work_type:hybrid' },
        { text: '🏙️ Onsite', callback_data: 'profile:work_type:onsite' },
      ]],
      botToken)
  }
}

// ── Start onboarding if needed ────────────────────────────────────────────────

export async function maybeStartOnboarding(
  tenantId: string,
  chatId: number,
  botToken: string,
  profile: UserProfile | null
): Promise<boolean> {
  if (isProfileComplete(profile)) return false

  const currentStep = await getOnboardingStep(tenantId)

  // Already mid-onboarding — don't restart
  if (currentStep && currentStep !== 'done') return true

  // Start from scratch
  const missing = getMissingProfileFields(profile)
  let firstStep: OnboardingStep = 'ask_roles'
  if (!missing.includes('target_roles') && missing.includes('skills'))    firstStep = 'ask_skills'
  else if (!missing.includes('skills')  && missing.includes('min_salary')) firstStep = 'ask_salary'

  await setOnboardingStep(tenantId, firstStep)
  await sendQuestion(firstStep, chatId, botToken)
  return true
}

// ── Handle a free-text reply during onboarding ───────────────────────────────

export async function handleOnboardingReply(
  tenantId: string,
  chatId: number,
  text: string,
  botToken: string
): Promise<boolean> {
  const step = await getOnboardingStep(tenantId)
  if (!step || step === 'done') return false

  const profile = await getProfile(tenantId)

  if (step === 'ask_roles') {
    const roles = text.split(/[,\n]+/).map(s => s.trim()).filter(Boolean)
    await upsertProfile(tenantId, { target_roles: roles })
    await setOnboardingStep(tenantId, 'ask_skills')
    await sendQuestion('ask_skills', chatId, botToken)
    return true
  }

  if (step === 'ask_skills') {
    const skills = text.split(/[,\n]+/).map(s => s.trim()).filter(Boolean)
    await upsertProfile(tenantId, { skills })
    await setOnboardingStep(tenantId, 'ask_salary')
    await sendQuestion('ask_salary', chatId, botToken)
    return true
  }

  if (step === 'ask_salary') {
    const salary = parseInt(text.replace(/[^0-9]/g, ''), 10)
    if (!isNaN(salary) && salary > 0) {
      await upsertProfile(tenantId, { min_salary: salary })
      await setOnboardingStep(tenantId, 'ask_location')
      await sendQuestion('ask_location', chatId, botToken)
    } else {
      await sendTelegram(chatId, `Please reply with a number, e.g. <b>70000</b>`, botToken)
    }
    return true
  }

  if (step === 'ask_location') {
    const locations = text.split(/[,\n]+/).map(s => s.trim()).filter(Boolean)
    await upsertProfile(tenantId, { target_locations: locations })

    // Check if work_type already set
    if (profile?.preferred_work_type && profile.preferred_work_type !== 'any') {
      await completeOnboarding(tenantId, chatId, botToken)
    } else {
      await setOnboardingStep(tenantId, 'ask_work_type')
      await sendQuestion('ask_work_type', chatId, botToken)
    }
    return true
  }

  return false
}

// ── Handle work_type button callback ─────────────────────────────────────────

export async function handleWorkTypeCallback(
  tenantId: string,
  chatId: number,
  workType: string,
  botToken: string
): Promise<void> {
  await upsertProfile(tenantId, { preferred_work_type: workType })
  await completeOnboarding(tenantId, chatId, botToken)
}

async function completeOnboarding(tenantId: string, chatId: number, botToken: string): Promise<void> {
  await setOnboardingStep(tenantId, 'done')
  await sendTelegram(chatId,
    `✅ <b>Profile saved!</b> FEN will now find matches tailored to you.\n\n` +
    `You'll receive your first personalised job digest shortly. You can update your profile anytime by messaging me.`,
    botToken)
}
