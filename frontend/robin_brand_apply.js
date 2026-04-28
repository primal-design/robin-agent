(() => {
  function mascotSrc() {
    return window.RobinMascot?.src || ''
  }

  function replaceImage(el) {
    const src = mascotSrc()
    if (!src || !el) return
    el.src = src
    el.alt = 'Robin'
    el.style.objectFit = 'contain'
  }

  function ensureLogo(container) {
    const src = mascotSrc()
    if (!src || !container) return
    if (container.querySelector('img')) return
    const img = document.createElement('img')
    img.src = src
    img.alt = 'Robin'
    img.style.cssText = 'height:28px;width:auto;object-fit:contain;opacity:.95;'
    container.insertBefore(img, container.firstChild)
  }

  function applyBrand() {
    document.querySelectorAll('#fox,.sb-fox,.ffox,.a-tb-fox,.si-logo img,.app-nav-brand img').forEach(replaceImage)
    document.querySelectorAll('.sb-brand,.fbrand,.a-tb-brand,.app-nav-brand').forEach(ensureLogo)
    window.RobinMascot?.replaceFoxEmoji?.()
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyBrand)
  else applyBrand()

  new MutationObserver(() => applyBrand()).observe(document.documentElement, { childList: true, subtree: true })
})()
