(() => {
  const TOKEN_KEY = 'robin_token'
  const originalFetch = window.fetch.bind(window)

  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || ''
  }

  function setToken(token) {
    if (!token) return
    localStorage.setItem(TOKEN_KEY, token)
    addLogoutButton()
  }

  function clearToken() {
    localStorage.removeItem(TOKEN_KEY)
    document.getElementById('robin-logout')?.remove()
  }

  function addLogoutButton() {
    if (document.getElementById('robin-logout')) return
    const btn = document.createElement('button')
    btn.id = 'robin-logout'
    btn.innerText = 'Logout'
    btn.style = 'position:fixed;top:10px;right:10px;z-index:9999'
    btn.onclick = () => {
      clearToken()
      window.location.reload()
    }
    document.body.appendChild(btn)
  }

  function isSameOrigin(input) {
    return typeof input === 'string' ? input.startsWith('/') : input?.url?.startsWith('/')
  }

  window.fetch = async (input, init = {}) => {
    const token = getToken()
    const headers = new Headers(init.headers || {})

    if (token && isSameOrigin(input) && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`)
    }

    const res = await originalFetch(input, { ...init, headers })

    if (res.status === 401) {
      clearToken()
      alert('Session expired. Please sign in again.')
    }

    const url = typeof input === 'string' ? input : input?.url || ''
    if (url.includes('/auth/verify-code') && res.ok) {
      try {
        const data = await res.clone().json()
        if (data?.token) setToken(data.token)
      } catch {}
    }

    return res
  }

  if (getToken()) addLogoutButton()
})()
