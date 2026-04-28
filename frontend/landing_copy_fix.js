(() => {
  function setText(selector, text) {
    const el = document.querySelector(selector)
    if (el) el.textContent = text
  }

  function setHTML(selector, html) {
    const el = document.querySelector(selector)
    if (el) el.innerHTML = html
  }

  function fixLandingCopy() {
    // Keep old URL, layout, typography, phone mockup, and sections.
    // Only update legally safer positioning copy.
    setText('.eyebrow', 'In your pocket · With your word')
    setHTML('h1', 'Others act on their own.<br><em>Robin acts with your word.</em>')
    setText('.hero-sub', 'A quiet hand in your messages. Tracks what matters. Prepares replies before you send. Surfaces what you forget.')
    setText('.hero-outcome', 'Bounded proactivity. Nothing goes unseen. Nothing without your word.')

    // Phone caption from the original visual direction.
    setText('.phone-cap', 'Ready before you asked.')

    // Section headline safety pass if present.
    setHTML('.h-left h2', 'What Robin <em>does.</em>')

    // Replace risky absolute/old-autonomy phrases anywhere they appear.
    const replacements = [
      ['In your pocket · On your command', 'In your pocket · With your word'],
      ['IN YOUR POCKET · ON YOUR COMMAND', 'IN YOUR POCKET · WITH YOUR WORD'],
      ['Others answer. Robin acts.', 'Others act on their own. Robin acts with your word.'],
      ['Others answer.', 'Others act on their own.'],
      ['Robin acts.', 'Robin acts with your word.'],
      ['chief of staff', 'quiet hand'],
      ['Chief of staff', 'Quiet hand'],
      ['Prepares every reply', 'Prepares replies before you send'],
      ['Closes what you forget', 'Surfaces what you forget'],
      ['Every message handled. Every follow-up done. Nothing left hanging.', 'Bounded proactivity. Nothing goes unseen. Nothing without your word.'],
      ['Every message handled', 'Messages surfaced'],
      ['Every follow-up done', 'Follow-ups tracked'],
      ['Nothing left hanging', 'Nothing without your word'],
      ['on your command', 'with your word'],
      ['On your command', 'With your word']
    ]

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    const nodes = []
    while (walker.nextNode()) nodes.push(walker.currentNode)
    for (const node of nodes) {
      let value = node.nodeValue || ''
      for (const [from, to] of replacements) value = value.split(from).join(to)
      node.nodeValue = value
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fixLandingCopy)
  else fixLandingCopy()
})()
