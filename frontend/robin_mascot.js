(() => {
  const ROBIN_MASCOT_SRC = 'data:image/webp;base64,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';

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

  window.RobinMascot = { src: ROBIN_MASCOT_SRC, makeMascot, replaceFoxEmoji }

  function initMascot() {
    replaceFoxEmoji()
    new MutationObserver(mutations => {
      for (const m of mutations) m.addedNodes.forEach(n => replaceFoxEmoji(n.nodeType === 1 ? n : n.parentElement))
    }).observe(document.body, { childList: true, subtree: true })
  }

  if (document.body) initMascot()
  else document.addEventListener('DOMContentLoaded', initMascot)
})()
