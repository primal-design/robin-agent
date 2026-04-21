/**
 * Robin Fox — animated SVG avatar controller
 * States: idle | typing | reply
 *
 * Usage:
 *   RobinFox.typing()   — Robin is thinking/typing
 *   RobinFox.reply()    — Robin just sent a message
 *   RobinFox.idle()     — back to idle breathing
 *
 * Inject into any page:
 *   <div id="fox-mount"></div>
 *   <script src="robin-fox.js"></script>
 */

const RobinFox = (() => {
  let container = null
  let replyTimer = null

  async function init(mountId = 'fox-mount') {
    const mount = document.getElementById(mountId)
    if (!mount) return

    // Fetch SVG inline so CSS animations work
    try {
      const res  = await fetch('/frontend/robin-fox.svg')
      const text = await res.text()
      mount.innerHTML = text
      container = mount.querySelector('#robin-fox')
      if (container) {
        container.style.width  = mount.dataset.size || '48px'
        container.style.height = mount.dataset.size || '48px'
      }
    } catch (e) {
      console.warn('[RobinFox] Could not load SVG', e)
    }
  }

  function setState(state) {
    if (!container) return
    container.classList.remove('fox-typing', 'fox-reply')
    if (state !== 'idle') container.classList.add(`fox-${state}`)
  }

  function typing() {
    clearTimeout(replyTimer)
    setState('typing')
  }

  function reply() {
    setState('reply')
    replyTimer = setTimeout(() => setState('idle'), 2000)
  }

  function idle() {
    clearTimeout(replyTimer)
    setState('idle')
  }

  // Auto-init when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => init())
  } else {
    init()
  }

  return { typing, reply, idle, init }
})()

// Patch setTyping if it exists on the page
if (typeof window !== 'undefined') {
  window.RobinFox = RobinFox

  // Hook into existing setTyping function after page loads
  window.addEventListener('load', () => {
    const origSetTyping = window.setTyping
    if (typeof origSetTyping === 'function') {
      window.setTyping = function(on) {
        origSetTyping(on)
        on ? RobinFox.typing() : RobinFox.idle()
      }
    }

    const origAddBubble = window.addBubble
    if (typeof origAddBubble === 'function') {
      window.addBubble = function(side, text) {
        origAddBubble(side, text)
        if (side === 'robin') RobinFox.reply()
      }
    }
  })
}
