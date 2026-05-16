import { Queue } from 'bullmq'

function redisConnection() {
  if (process.env.REDIS_URL) return { url: process.env.REDIS_URL }
  return { host: process.env.REDIS_HOST ?? 'localhost', port: 6379 }
}

export const eventQueue = new Queue('fen-events', {
  connection: redisConnection(),
})
