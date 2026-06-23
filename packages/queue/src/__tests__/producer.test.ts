import { describe, it, expect, vi } from 'vitest'
import type { Queue } from 'bullmq'
import type { MessageJob } from '../types.js'

const JOB_DATA: MessageJob = {
  instanceId: 'inst-1',
  contactId: 'contact-1',
  messageId: 'msg-1',
  conversationId: 'conv-1',
  evolutionInstanceName: 'test-instance',
  contactPhone: '5511999999999',
}

describe('enqueueMessage', () => {
  it('adds job to queue with retry config and returns job id', async () => {
    const { enqueueMessage } = await import('../producer.js')
    const mockAdd = vi.fn().mockResolvedValue({ id: 'job-123' })
    const mockQueue = { add: mockAdd } as unknown as Queue<MessageJob>

    const jobId = await enqueueMessage(mockQueue, JOB_DATA)

    expect(mockAdd).toHaveBeenCalledWith(
      'process-message',
      JOB_DATA,
      expect.objectContaining({ attempts: 4 }),
    )
    expect(jobId).toBe('job-123')
  })

  it('throws if queue returns no job id', async () => {
    const { enqueueMessage } = await import('../producer.js')
    const mockQueue = { add: vi.fn().mockResolvedValue({ id: undefined }) } as unknown as Queue<MessageJob>
    await expect(enqueueMessage(mockQueue, JOB_DATA)).rejects.toThrow('BullMQ did not return a job id')
  })
})
