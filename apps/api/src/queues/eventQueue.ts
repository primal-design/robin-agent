import { Queue } from 'bullmq'

function redisConnection() {
  const url = process.env.REDIS_URL
  if (url) {
    const tls = url.startsWith('rediss://') ? { tls: { rejectUnauthorized: false } } : {}
    return { url, ...tls }
  }
  return { host: process.env.REDIS_HOST ?? 'localhost', port: 6379 }
}

export const eventQueue = new Queue('fen-events', {
  connection: redisConnection(),
})
