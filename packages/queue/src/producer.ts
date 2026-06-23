import { Queue } from 'bullmq'
import type { ConnectionOptions } from 'bullmq'
import { MESSAGE_QUEUE_NAME, type MessageJob } from './types.js'

export function createMessageQueue(connection: ConnectionOptions): Queue<MessageJob> {
  return new Queue<MessageJob>(MESSAGE_QUEUE_NAME, { connection })
}

export async function enqueueMessage(
  queue: Queue<MessageJob>,
  data: MessageJob,
): Promise<string> {
  const job = await queue.add('process-message', data, {
    attempts: 4,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  })
  if (!job.id) throw new Error('BullMQ did not return a job id')
  return job.id
}
