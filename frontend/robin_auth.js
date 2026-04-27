// Robin frontend auth shim
// Stores signed session tokens returned by /auth/verify-code and adds them
// to same-origin API requests as Authorization: Bearer <token>.
(() => {
  const TOKEN_KEY = 'robin_token'
  const LEGACY_KEYS = ['robin_session', 'sessionId']
  const originalFetch = window.fetch.bind(window)

  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || LEGACY_KEYS.map(k => localStorage.getItem(k)).find(Boolean) || ''
  }

  function setToken(token) {
    if (!token) return
    localStorage.setItem(TOKEN_KEY, token)
    for (const key of LEGACY_KEYS) localStorage.removeItem(key)
  }

  function clearToken() {
    localStorage.removeItem(TOKEN_KEY)
    for (const key of LEGACY_KEYS) localStorage.removeItem(key)
  }

  function isSameOrigin(input) {
    try {
      if (typeof input === 'string') return input.startsWith('/') || new URL(input, window.location.origin).origin === window.location.origin
      if (input && input.url) return new URL(input.url, window.location.origin).origin === window.location.origin
    } catch {}
    return false
  }

  function urlOf(input) {
    return typeof input === 'string' ? input : input?.url || ''
  }

  window.RobinAuth = { getToken, setToken, clearToken }

  window.fetch = async (input, init = {}) => {
    const token = getToken()
    const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined))

    if (token && isSameOrigin(input) && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`)
    }

    const response = await originalFetch(input, { ...init, headers })
    const url = urlOf(input)

    if (url.includes('/auth/verify-code') && response.ok) {
      try {
        const data = await response.clone().json()
        if (data?.token) setToken(data.token)
      } catch {}
    }

    return response
  }
})()
