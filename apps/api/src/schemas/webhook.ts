import { z } from 'zod'

export const WebhookPayloadSchema = z.object({
  event: z.string(),
  instance: z.string(),
  apikey: z.string().optional(),
  data: z.object({
    key: z.object({
      remoteJid: z.string(),
      fromMe: z.boolean(),
      id: z.string(),
    }),
    message: z.record(z.unknown()).optional(),
    pushName: z.string().optional(),
  }),
})

export type ParsedWebhookPayload = z.infer<typeof WebhookPayloadSchema>
