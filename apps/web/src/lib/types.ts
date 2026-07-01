export interface UserProfile {
  id: string
  email: string
  full_name?: string
  headline?: string
  skills: string[]
  seniority?: string
  experience_years?: number
  work_type?: 'remote' | 'hybrid' | 'onsite' | 'any'
  location?: string
  cv_text?: string
  created_at?: string
}

export interface Job {
  id: string
  title: string
  company: string
  location?: string
  salary_min?: number
  salary_max?: number
  salary_currency?: string
  description?: string
  url?: string
  source?: string
  posted_at?: string
  fetched_at?: string
}

export interface JobMatch {
  id: string
  job: Job
  score: number
  skill_matches: string[]
  skill_gaps: string[]
  recommendation?: string
  user_feedback?: MatchFeedback
  applied?: boolean
  applied_at?: string
  status?: 'new' | 'applied' | 'interview' | 'offer' | 'rejected'
  created_at?: string
}

export type MatchFeedback = 'interested' | 'skip' | 'not_relevant'

export interface TodayStats {
  jobs_scanned: number
  matches_found: number
  applications_sent: number
  interviews: number
  next_scan?: string
}

export interface AuthUser {
  email: string
  tenantId: string
  token: string
}
