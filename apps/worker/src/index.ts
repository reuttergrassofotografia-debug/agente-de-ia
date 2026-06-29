import { Worker, Queue } from 'bullmq'
import { MESSAGE_QUEUE_NAME, createRedisConnection, type MessageJob } from '@agente/queue'
import { createSupabaseClient, createJobFailure, updateMessageStatus } from '@agente/db'
import { EvolutionClient } from '@agente/evolution'
import { loadEnv } from './env.js'
import { processMessage } from './processor.js'
import { processScheduledMessages } from './scheduledProcessor.js'

const env = loadEnv()
const db = createSupabaseClient()
const evolution = new EvolutionClient(env.EVOLUTION_API_URL, env.EVOLUTION_API_KEY)
const connection = createRedisConnection(env.REDIS_URL)

const worker = new Worker<MessageJob>(
  MESSAGE_QUEUE_NAME,
  (job) => processMessage(job, { db, evolution }),
  { connection, concurrency: 5 },
)

const SCHEDULED_QUEUE = 'scheduled-messages'
const scheduledQueue = new Queue(SCHEDULED_QUEUE, { connection: createRedisConnection(env.REDIS_URL) })
await scheduledQueue.add('tick', {}, { repeat: { every: 60_000 }, jobId: 'scheduled-tick' })

const scheduledWorker = new Worker(
  SCHEDULED_QUEUE,
  async () => processScheduledMessages({ db, evolution }),
  { connection: createRedisConnection(env.REDIS_URL), concurrency: 1 },
)

worker.on('completed', (job) => {
  console.log(JSON.stringify({ event: 'job.completed', jobId: job.id, messageId: job.data.messageId }))
})

worker.on('failed', async (job, err) => {
  if (!job) return
  const isLastAttempt = job.attemptsMade >= (job.opts.attempts ?? 1)
  if (isLastAttempt) {
    const { messageId, instanceId, contactId } = job.data
    await createJobFailure(db, { message_id: messageId, error: err.message, attempts: job.attemptsMade })
    await updateMessageStatus(db, messageId, 'failed')
    console.error(JSON.stringify({ event: 'job.dead', messageId, instanceId, contactId, error: err.message, attempts: job.attemptsMade }))
  }
})

console.log(JSON.stringify({ event: 'worker.started', queue: MESSAGE_QUEUE_NAME, concurrency: 5 }))
