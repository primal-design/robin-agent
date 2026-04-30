(() => {
  const ROBIN_LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 130" fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"><path d="M18,82 L45,18 L62,55"/><path d="M58,55 L78,12 L98,62"/><path d="M98,62 Q108,95 88,112 Q68,125 52,108 Q40,96 44,82"/></svg>`

  const ROBIN_MASCOT_SRC = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(ROBIN_LOGO_SVG.replace('currentColor', '#1A1816'))

  function makeMascot() {
    const img = document.createElement('img')
    img.src = ROBIN_MASCOT_SRC
    img.alt = 'Robin'
    img.title = 'Robin'
    img.style.cssText = 'width:1.35em;height:1.35em;vertical-align:-0.28em;margin:0 0.1em;border-radius:0.25em;display:inline-block;object-fit:contain;'
    return img
  }

  function replaceFoxEmoji(root = document.body) {
    if (!root) return
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const nodes = []
    while (walker.nextNode()) {
      if (walker.currentNode.nodeValue?.includes('🦊')) nodes.push(walker.currentNode)
    }
    for (const node of nodes) {
      const frag = document.createDocumentFragment()
      const parts = node.nodeValue.split('🦊')
      parts.forEach((part, i) => {
        if (part) frag.appendChild(document.createTextNode(part))
        if (i < parts.length - 1) frag.appendChild(makeMascot())
      })
      node.parentNode?.replaceChild(frag, node)
    }
  }

  window.RobinMascot = { src: ROBIN_MASCOT_SRC, svgSrc: ROBIN_LOGO_SVG, makeMascot, replaceFoxEmoji }

  function initMascot() {
    replaceFoxEmoji()
    new MutationObserver(mutations => {
      for (const m of mutations) m.addedNodes.forEach(n => replaceFoxEmoji(n.nodeType === 1 ? n : n.parentElement))
    }).observe(document.body, { childList: true, subtree: true })
  }

  if (document.body) initMascot()
  else document.addEventListener('DOMContentLoaded', initMascot)
})()
