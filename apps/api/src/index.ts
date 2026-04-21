import { assertRequired, env } from './config/env.js'
import { createApp } from './app.js'

assertRequired()

const app = createApp()

app.listen(env.port, () => {
  console.log(`🦊 Robin API running at http://localhost:${env.port}`)
})
