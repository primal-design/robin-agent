import { env } from '../config/env.js'

const HUBSPOT_AUTH_URL  = 'https://app.hubspot.com/oauth/authorize'
const HUBSPOT_TOKEN_URL = 'https://api.hubspot.com/oauth/v1/token'
const HUBSPOT_API_BASE  = 'https://api.hubapi.com'

const HUBSPOT_SCOPES = [
  'crm.objects.contacts.read',
  'crm.objects.companies.read',
  'crm.objects.deals.read',
].join(' ')

export interface HubspotTokenResult {
  access_token:  string
  refresh_token: string
  expires_in:    number
  expiry_date:   number
}

export function getHubspotAuthUrl(state: string, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id:    env.hubspotClientId,
    redirect_uri: redirectUri,
    scope:        HUBSPOT_SCOPES,
    state,
  })
  return `${HUBSPOT_AUTH_URL}?${params}`
}

export async function exchangeHubspotCode(
  code: string,
  redirectUri: string
): Promise<HubspotTokenResult> {
  const body = new URLSearchParams({
    grant_type:    'authorization_code',
    client_id:     env.hubspotClientId,
    client_secret: env.hubspotClientSecret,
    redirect_uri:  redirectUri,
    code,
  })
  const res = await fetch(HUBSPOT_TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  })
  if (!res.ok) throw new Error(`HubSpot token exchange failed: ${await res.text()}`)
  const data = await res.json() as Record<string, unknown>
  const expiresIn = Number(data.expires_in ?? 1800)
  return {
    access_token:  String(data.access_token),
    refresh_token: String(data.refresh_token),
    expires_in:    expiresIn,
    expiry_date:   Date.now() + expiresIn * 1000,
  }
}

export async function refreshHubspotTokens(
  refreshToken: string,
  redirectUri: string
): Promise<{ access_token: string; expiry_date: number }> {
  const body = new URLSearchParams({
    grant_type:    'refresh_token',
    client_id:     env.hubspotClientId,
    client_secret: env.hubspotClientSecret,
    redirect_uri:  redirectUri,
    refresh_token: refreshToken,
  })
  const res = await fetch(HUBSPOT_TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    body.toString(),
  })
  if (!res.ok) throw new Error(`HubSpot token refresh failed: ${await res.text()}`)
  const data = await res.json() as Record<string, unknown>
  const expiresIn = Number(data.expires_in ?? 1800)
  return {
    access_token: String(data.access_token),
    expiry_date:  Date.now() + expiresIn * 1000,
  }
}

export async function getHubspotConnectedAccount(accessToken: string): Promise<string> {
  try {
    const res = await fetch(`${HUBSPOT_API_BASE}/oauth/v1/access-tokens/${accessToken}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) return 'unknown'
    const data = await res.json() as Record<string, unknown>
    return String(data.user ?? data.hub_domain ?? 'unknown')
  } catch {
    return 'unknown'
  }
}

export interface HubspotCompany {
  id:                string
  name:              string
  domain?:           string
  industry?:         string
  city?:             string
  country?:          string
  phone?:            string
  numberOfEmployees?: string
}

export async function listHubspotCompanies(
  accessToken: string,
  limit = 50
): Promise<HubspotCompany[]> {
  const params = new URLSearchParams({
    limit:      String(limit),
    properties: 'name,domain,industry,city,country,phone,numberofemployees',
  })
  const res = await fetch(`${HUBSPOT_API_BASE}/crm/v3/objects/companies?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`HubSpot companies list failed: ${res.status}`)
  const data = await res.json() as { results?: { id: string; properties: Record<string, string> }[] }
  return (data.results ?? []).map(r => ({
    id:                r.id,
    name:              r.properties.name   ?? '',
    domain:            r.properties.domain ?? '',
    industry:          r.properties.industry ?? '',
    city:              r.properties.city   ?? '',
    country:           r.properties.country ?? '',
    phone:             r.properties.phone  ?? '',
    numberOfEmployees: r.properties.numberofemployees ?? '',
  }))
}

export interface HubspotDeal {
  id:        string
  name:      string
  stage?:    string
  amount?:   string
  closeDate?: string
  pipeline?: string
}

export async function listHubspotDeals(
  accessToken: string,
  limit = 50
): Promise<HubspotDeal[]> {
  const params = new URLSearchParams({
    limit:      String(limit),
    properties: 'dealname,dealstage,amount,closedate,pipeline',
    sort:       '-createdate',
  })
  const res = await fetch(`${HUBSPOT_API_BASE}/crm/v3/objects/deals?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`HubSpot deals list failed: ${res.status}`)
  const data = await res.json() as { results?: { id: string; properties: Record<string, string> }[] }
  return (data.results ?? []).map(r => ({
    id:        r.id,
    name:      r.properties.dealname  ?? '',
    stage:     r.properties.dealstage ?? '',
    amount:    r.properties.amount    ?? '',
    closeDate: r.properties.closedate ?? '',
    pipeline:  r.properties.pipeline  ?? '',
  }))
}

export interface HubspotContact {
  id:        string
  firstName?: string
  lastName?:  string
  email?:     string
  company?:   string
  jobTitle?:  string
}

export async function listHubspotContacts(
  accessToken: string,
  limit = 100
): Promise<HubspotContact[]> {
  const params = new URLSearchParams({
    limit:      String(limit),
    properties: 'firstname,lastname,email,company,jobtitle',
    sort:       '-lastmodifieddate',
  })
  const res = await fetch(`${HUBSPOT_API_BASE}/crm/v3/objects/contacts?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  if (!res.ok) throw new Error(`HubSpot contacts list failed: ${res.status}`)
  const data = await res.json() as { results?: { id: string; properties: Record<string, string> }[] }
  return (data.results ?? []).map(r => ({
    id:        r.id,
    firstName: r.properties.firstname ?? '',
    lastName:  r.properties.lastname  ?? '',
    email:     r.properties.email     ?? '',
    company:   r.properties.company   ?? '',
    jobTitle:  r.properties.jobtitle  ?? '',
  }))
}
