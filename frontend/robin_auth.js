(() => {
  const TOKEN = 'robin_token'
  const REFRESH = 'robin_refresh'
  const originalFetch = window.fetch.bind(window)

  function setStatus(msg) {
    let el = document.getElementById('robin-status')
    if (!el) {
      el = document.createElement('div')
      el.id = 'robin-status'
      el.style = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#111;color:#fff;padding:10px 16px;border-radius:8px;z-index:9999;font-size:14px'
      document.body.appendChild(el)
    }
    el.innerText = msg
  }

  function setSession(data) {
    localStorage.setItem(TOKEN, data.token)
    if (data.refresh_token) localStorage.setItem(REFRESH, data.refresh_token)
    addLogout()
  }

  function clearSession() {
    localStorage.removeItem(TOKEN)
    localStorage.removeItem(REFRESH)
    document.getElementById('robin-logout')?.remove()
  }

  async function refreshSession() {
    const r = localStorage.getItem(REFRESH)
    if (!r) return false
    const res = await originalFetch('/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: r })
    })
    if (!res.ok) return false
    const data = await res.json()
    setSession(data)
    return true
  }

  function addLogout() {
    if (document.getElementById('robin-logout')) return
    const btn = document.createElement('button')
    btn.id = 'robin-logout'
    btn.innerText = 'Logout'
    btn.style = 'position:fixed;top:10px;right:10px;z-index:9999'
    btn.onclick = () => {
      clearSession()
      location.href = '/frontend/robin_site.html'
    }
    document.body.appendChild(btn)
  }

  function handleMagicLink() {
    const params = new URLSearchParams(location.search)
    const token = params.get('token')
    const refresh = params.get('refresh')
    if (token) {
      localStorage.setItem(TOKEN, token)
      if (refresh) localStorage.setItem(REFRESH, refresh)
      history.replaceState({}, '', '/frontend/robin_dashboard.html')
      setStatus('Logged in ✨')
    }
  }

  window.fetch = async (input, init = {}) => {
    const token = localStorage.getItem(TOKEN)
    const headers = new Headers(init.headers || {})

    if (token && typeof input === 'string' && input.startsWith('/')) {
      headers.set('Authorization', `Bearer ${token}`)
    }

    let res = await originalFetch(input, { ...init, headers })

    if (res.status === 401) {
      const ok = await refreshSession()
      if (ok) {
        const newToken = localStorage.getItem(TOKEN)
        headers.set('Authorization', `Bearer ${newToken}`)
        res = await originalFetch(input, { ...init, headers })
      } else {
        clearSession()
        setStatus('Session expired — sign in again')
      }
    }

    const url = typeof input === 'string' ? input : input?.url || ''

    if (url.includes('/auth/verify-code') && res.ok) {
      const data = await res.clone().json()
      setSession(data)
      setStatus('Welcome back ✨')
    }

    if (url.includes('/auth/send-code')) {
      const data = await res.clone().json()
      if (data.debug_code) setStatus(`Dev code: ${data.debug_code}`)
      else setStatus('Check WhatsApp or email')
    }

    if (url.includes('/auth/send-magic-link') && res.ok) {
      setStatus('Magic link sent ✨ Check your email')
    }

    return res
  }

  handleMagicLink()
  if (localStorage.getItem(TOKEN)) addLogout()
})()
