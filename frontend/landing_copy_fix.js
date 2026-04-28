(() => {
  function setText(selector, text) {
    const el = document.querySelector(selector)
    if (el) el.textContent = text
  }

  function setHTML(selector, html) {
    const el = document.querySelector(selector)
    if (el) el.innerHTML = html
  }

  function findTextNode(pattern) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const node = walker.currentNode
      if (node.nodeValue && pattern.test(node.nodeValue)) return node
    }
    return null
  }

  function replaceTextEverywhere(from, to) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    const nodes = []
    while (walker.nextNode()) nodes.push(walker.currentNode)
    for (const node of nodes) {
      if (node.nodeValue && node.nodeValue.includes(from)) node.nodeValue = node.nodeValue.split(from).join(to)
    }
  }

  function updatePhoneMockup() {
    replaceTextEverywhere('iMessage', 'WhatsApp')
    replaceTextEverywhere('IMESSAGE', 'WHATSAPP')
    replaceTextEverywhere('Messages · iMessage', 'Messages · WhatsApp')
    replaceTextEverywhere('MESSAGES · IMESSAGE', 'MESSAGES · WHATSAPP')

    const firstInbound = document.querySelector('.pm.i')
    const firstOutbound = document.querySelector('.pm.o')
    if (firstInbound) firstInbound.textContent = 'Hey Robin, draft a reply to James about the proposal.'
    if (firstOutbound) firstOutbound.textContent = 'Done. Want me to send or tweak?'

    const alertCard = document.querySelector('.pm.a')
    if (alertCard) {
      alertCard.innerHTML = `
        <div class="al">WhatsApp</div>
        <div class="aw">Reply ready</div>
        <div class="al2">James · proposal</div>
        <div class="ad">“Hey James — thanks for sending that over. I’ll review it today and come back with a clear next step.”</div>
        <div class="abs"><button class="ab s">Send</button><button class="ab e">Tweak</button></div>
      `
    }
  }

  function fixLandingCopy() {
    // Keep the existing visual layout, fonts, colours, CTAs, and phone frame.
    // Only swap content and platform wording.
    setText('.eyebrow', 'IN YOUR POCKET · ON WHATSAPP')
    setHTML('h1', 'Robin isn’t built yet.<br><em>You build it.</em>')
    setText('.hero-sub', 'In your pocket. With your word. It lives in WhatsApp. Just message it. Shape it into what you need — for yourself or your clients.')
    setText('.hero-outcome', 'Start now. If not now — you won’t.')

    updatePhoneMockup()

    const replacements = [
      ['IN YOUR POCKET · ON YOUR COMMAND', 'IN YOUR POCKET · ON WHATSAPP'],
      ['In your pocket · On your command', 'IN YOUR POCKET · ON WHATSAPP'],
      ['IN YOUR POCKET · WITH YOUR WORD', 'IN YOUR POCKET · ON WHATSAPP'],
      ['In your pocket · With your word', 'IN YOUR POCKET · ON WHATSAPP'],
      ['Others answer.', 'Robin isn’t built yet.'],
      ['Others act on their own.', 'Robin isn’t built yet.'],
      ['Robin acts.', 'You build it.'],
      ['Robin acts with your word.', 'You build it.'],
      ['A quiet chief of staff in your messages. Tracks what matters. Prepares every reply. Closes what you forget.', 'In your pocket. With your word. It lives in WhatsApp. Just message it. Shape it into what you need — for yourself or your clients.'],
      ['A quiet hand in your messages. Tracks what matters. Prepares replies before you send. Surfaces what you forget.', 'In your pocket. With your word. It lives in WhatsApp. Just message it. Shape it into what you need — for yourself or your clients.'],
      ['Every message handled. Every follow-up done. Nothing left hanging.', 'Start now. If not now — you won’t.'],
      ['Bounded proactivity. Nothing goes unseen. Nothing without your word.', 'Start now. If not now — you won’t.']
    ]

    for (const [from, to] of replacements) replaceTextEverywhere(from, to)
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fixLandingCopy)
  else fixLandingCopy()
})()
