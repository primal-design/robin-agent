import { env } from '../config/env.js'

// ── Postcode lookup (postcodes.io — no key) ───────────────────────────────────
export async function lookupPostcode(postcode: string): Promise<string | null> {
  try {
    const clean = postcode.replace(/\s+/g, '').toUpperCase()
    const res   = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(clean)}`, { signal: AbortSignal.timeout(6000) })
    if (!res.ok) return null
    const data  = await res.json() as {
      status: number
      result?: {
        postcode: string
        district: string
        ward: string
        county: string | null
        country: string
        region: string
        parliamentary_constituency: string
        admin_district: string
        latitude: number
        longitude: number
      }
    }
    if (data.status !== 200 || !data.result) return `Postcode ${postcode} not found.`
    const r = data.result
    return [
      `Postcode: ${r.postcode}`,
      `Area: ${r.admin_district}${r.county ? `, ${r.county}` : ''}`,
      `Region: ${r.region}`,
      `Ward: ${r.ward}`,
      `Constituency: ${r.parliamentary_constituency}`,
      `Country: ${r.country}`,
      `Coordinates: ${r.latitude}, ${r.longitude}`,
    ].join('\n')
  } catch { return null }
}

// ── Nearby postcodes ──────────────────────────────────────────────────────────
export async function nearbyPostcodes(postcode: string, radius = 1000): Promise<string | null> {
  try {
    const clean = postcode.replace(/\s+/g, '').toUpperCase()
    const res   = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(clean)}/nearest?limit=5&radius=${radius}`, { signal: AbortSignal.timeout(6000) })
    if (!res.ok) return null
    const data  = await res.json() as { status: number; result?: { postcode: string; district: string; distance: number }[] }
    if (!data.result?.length) return null
    return `Nearby postcodes to ${postcode}:\n` + data.result.map(r => `• ${r.postcode} — ${r.district} (${Math.round(r.distance)}m)`).join('\n')
  } catch { return null }
}

// ── NHS services via Google Maps (no NHS key needed) ──────────────────────────
async function nhsServicesViaGoogleMaps(postcode: string, type: 'hospitals' | 'gps' | 'pharmacies'): Promise<string | null> {
  if (!env.googleMapsKey) return null
  const keywordMap = { hospitals: 'NHS hospital', gps: 'GP surgery doctor', pharmacies: 'pharmacy chemist' }
  const keyword = keywordMap[type]
  try {
    const query = encodeURIComponent(`${keyword} near ${postcode}`)
    const res   = await fetch(`https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&key=${env.googleMapsKey}`, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const data  = await res.json() as { results: { name: string; formatted_address: string; rating?: number; opening_hours?: { open_now?: boolean } }[] }
    if (!data.results?.length) return null
    const label = type.charAt(0).toUpperCase() + type.slice(1)
    return `${label} near ${postcode} (Google Maps):\n` + data.results.slice(0, 6).map(r =>
      `• ${r.name}\n  ${r.formatted_address}${r.rating ? ` | ⭐ ${r.rating}` : ''}${r.opening_hours?.open_now !== undefined ? (r.opening_hours.open_now ? ' | Open now' : ' | Closed') : ''}`
    ).join('\n\n')
  } catch { return null }
}

// ── NHS services (NHS API with Google Maps fallback) ──────────────────────────
export async function nhsServices(postcode: string, type: 'hospitals' | 'gps' | 'pharmacies' = 'hospitals'): Promise<string | null> {
  try {
    // First get lat/lon from postcode
    const clean  = postcode.replace(/\s+/g, '').toUpperCase()
    const geoRes = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(clean)}`, { signal: AbortSignal.timeout(6000) })
    if (!geoRes.ok) return nhsServicesViaGoogleMaps(postcode, type)
    const geoData = await geoRes.json() as { result?: { latitude: number; longitude: number } }
    if (!geoData.result) return nhsServicesViaGoogleMaps(postcode, type)
    const { latitude, longitude } = geoData.result

    if (!env.nhsApiKey) return nhsServicesViaGoogleMaps(postcode, type)

    const typeMap: Record<string, string> = {
      hospitals:  'HOS',
      gps:        'GP',
      pharmacies: 'PHA',
    }
    const orgType = typeMap[type] || 'HOS'

    const headers: Record<string, string> = { 'Accept': 'application/json', 'subscription-key': env.nhsApiKey }

    const url = `https://api.service.nhs.uk/service-search-api/search?$filter=OrganisationTypeID eq '${orgType}'&$orderby=distance&$top=8&latitude=${latitude}&longitude=${longitude}&distance=10`
    const res  = await fetch(url, { headers, signal: AbortSignal.timeout(8000) })
    if (!res.ok) return nhsServicesViaGoogleMaps(postcode, type)
    const data  = await res.json() as {
      value?: {
        OrganisationName: string
        Address1: string
        City: string
        Postcode: string
        Phone: string
        Distance: number
      }[]
    }
    if (!data.value?.length) return nhsServicesViaGoogleMaps(postcode, type)

    const label = type.charAt(0).toUpperCase() + type.slice(1)
    return `${label} near ${postcode}:\n` + data.value.map(s =>
      `• ${s.OrganisationName}\n  ${s.Address1}, ${s.City}, ${s.Postcode}\n  📞 ${s.Phone || 'N/A'} | ${s.Distance?.toFixed(1) || '?'}mi away`
    ).join('\n\n')
  } catch { return null }
}

// ── TfL bus arrivals (London only) ────────────────────────────────────────────
export async function tflBusArrivals(stopCode: string): Promise<string | null> {
  try {
    const params = env.tflAppKey ? `?app_key=${env.tflAppKey}` : ''
    const res    = await fetch(`https://api.tfl.gov.uk/StopPoint/${encodeURIComponent(stopCode)}/Arrivals${params}`, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const data   = await res.json() as { lineName: string; destinationName: string; timeToStation: number; vehicleId: string }[]
    if (!Array.isArray(data) || !data.length) return `No arrivals found for stop ${stopCode}.`
    const sorted = data.sort((a, b) => a.timeToStation - b.timeToStation).slice(0, 8)
    return `Bus arrivals at stop ${stopCode}:\n` + sorted.map(a => {
      const mins = Math.round(a.timeToStation / 60)
      return `• ${a.lineName} → ${a.destinationName}: ${mins === 0 ? 'Due' : `${mins} min`}`
    }).join('\n')
  } catch { return null }
}

// ── TfL stop search by name/postcode ─────────────────────────────────────────
export async function tflStopSearch(query: string): Promise<string | null> {
  try {
    const params = env.tflAppKey ? `&app_key=${env.tflAppKey}` : ''
    const res    = await fetch(`https://api.tfl.gov.uk/StopPoint/Search/${encodeURIComponent(query)}?modes=bus${params}`, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const data   = await res.json() as { matches?: { id: string; name: string; towards: string }[] }
    if (!data.matches?.length) return `No bus stops found for "${query}".`
    return `Bus stops matching "${query}":\n` + data.matches.slice(0, 6).map(s =>
      `• ${s.name} (Stop ID: ${s.id})${s.towards ? ` → towards ${s.towards}` : ''}`
    ).join('\n')
  } catch { return null }
}

// ── BODS national bus routes ──────────────────────────────────────────────────
export async function bodsRouteSearch(query: string): Promise<string | null> {
  try {
    const headers: Record<string, string> = {}
    if (env.bodsApiKey) headers['Authorization'] = `Token ${env.bodsApiKey}`
    const res  = await fetch(`https://data.bus-data.dft.gov.uk/api/v1/dataset/?search=${encodeURIComponent(query)}&status=published&limit=8`, {
      headers, signal: AbortSignal.timeout(8000)
    })
    if (!res.ok) return null
    const data = await res.json() as {
      results?: {
        name: string
        description: string
        operatorName: string
        noc: string
      }[]
    }
    if (!data.results?.length) return `No bus routes found for "${query}".`
    return `Bus routes matching "${query}":\n` + data.results.map(r =>
      `• ${r.name} — ${r.operatorName}\n  ${r.description || ''}`
    ).join('\n\n')
  } catch { return null }
}

// ── TfL Line info ─────────────────────────────────────────────────────────────
export async function tflLineInfo(lineId: string): Promise<string | null> {
  try {
    const params = env.tflAppKey ? `?app_key=${env.tflAppKey}` : ''
    const res    = await fetch(`https://api.tfl.gov.uk/Line/${encodeURIComponent(lineId)}/Route${params}`, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const data   = await res.json() as { id: string; name: string; routeSections: { name: string; originator: string; destination: string }[] }[]
    if (!Array.isArray(data) || !data.length) return `No route found for bus ${lineId}.`
    const line = data[0]
    const sections = (line.routeSections || []).slice(0, 6).map(s => `  • ${s.originator} → ${s.destination}`).join('\n')
    return `Bus ${line.id} (${line.name}):\n${sections || 'No route sections available.'}`
  } catch { return null }
}

// ── TfL journey planner ───────────────────────────────────────────────────────
export async function tflJourney(from: string, to: string): Promise<string | null> {
  try {
    const params = new URLSearchParams({ mode: 'bus,walking', ...(env.tflAppKey ? { app_key: env.tflAppKey } : {}) })
    const url    = `https://api.tfl.gov.uk/Journey/JourneyResults/${encodeURIComponent(from)}/to/${encodeURIComponent(to)}?${params}`
    const res    = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) return null
    const data   = await res.json() as {
      journeys?: {
        duration: number
        legs: { instruction: { summary: string }; duration: number; mode: { name: string } }[]
      }[]
    }
    if (!data.journeys?.length) return `No bus journey found from ${from} to ${to}.`
    const j = data.journeys[0]
    const legs = j.legs.map(l => `  • ${l.instruction?.summary} (${l.duration} min, ${l.mode?.name})`).join('\n')
    return `Journey from ${from} to ${to}:\nTotal: ${j.duration} mins\n${legs}`
  } catch { return null }
}

// ── TfL line status (disruptions) ────────────────────────────────────────────
export async function tflLineStatus(mode = 'bus'): Promise<string | null> {
  try {
    const params = env.tflAppKey ? `?app_key=${env.tflAppKey}` : ''
    const res    = await fetch(`https://api.tfl.gov.uk/Line/Mode/${mode}/Status${params}`, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const data   = await res.json() as { id: string; lineStatuses: { statusSeverityDescription: string; reason?: string }[] }[]
    if (!Array.isArray(data)) return null
    const disrupted = data.filter(l => l.lineStatuses?.[0]?.statusSeverityDescription !== 'Good Service')
    if (!disrupted.length) return 'All bus services are running normally.'
    return `Bus disruptions:\n` + disrupted.slice(0, 10).map(l => {
      const status = l.lineStatuses[0]
      return `• Bus ${l.id}: ${status.statusSeverityDescription}${status.reason ? `\n  ${status.reason.slice(0, 120)}` : ''}`
    }).join('\n\n')
  } catch { return null }
}

// ── Combined UK local services lookup ────────────────────────────────────────
export async function ukLocalServices(postcode: string): Promise<string> {
  const [postcodeInfo, hospitals, gps, pharmacies] = await Promise.all([
    lookupPostcode(postcode),
    nhsServices(postcode, 'hospitals'),
    nhsServices(postcode, 'gps'),
    nhsServices(postcode, 'pharmacies'),
  ])

  const parts: string[] = []
  if (postcodeInfo) parts.push(`LOCATION:\n${postcodeInfo}`)
  if (hospitals)    parts.push(hospitals)
  if (gps)          parts.push(gps)
  if (pharmacies)   parts.push(pharmacies)

  return parts.length ? parts.join('\n\n') : `Could not find services near ${postcode}.`
}
