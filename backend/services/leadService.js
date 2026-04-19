/**
 * Lead service — Google Maps business discovery
 */

export async function findLocalLeads(niche, location, limit = 10) {
  if (!process.env.GOOGLE_MAPS_KEY) return []
  try {
    const query = encodeURIComponent(`${niche} in ${location}`)
    const url   = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&key=${process.env.GOOGLE_MAPS_KEY}`
    const res   = await fetch(url)
    const data  = await res.json()
    return (data.results || []).slice(0, limit).map(p => ({
      name:     p.name,
      address:  p.formatted_address,
      rating:   p.rating,
      reviews:  p.user_ratings_total,
      place_id: p.place_id,
    }))
  } catch { return [] }
}

export async function getPlaceDetails(placeId) {
  if (!process.env.GOOGLE_MAPS_KEY) return null
  try {
    const url  = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=name,formatted_phone_number,website,rating,reviews,formatted_address&key=${process.env.GOOGLE_MAPS_KEY}`
    const res  = await fetch(url)
    const data = await res.json()
    return data.result || null
  } catch { return null }
}
