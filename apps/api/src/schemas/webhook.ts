import { z } from 'zod'

export const WebhookPayloadSchema = z.object({
  event: z.string(),
  instance: z.string(),
  data: z.object({
    key: z.object({
      remoteJid: z.string(),
      fromMe: z.boolean(),
      id: z.string(),
    }),
    message: z.object({
      conversation: z.string().optional(),
      extendedTextMessage: z.object({ text: z.string() }).optional(),
    }),
    pushName: z.string().optional(),
  }),
})

export type ParsedWebhookPayload = z.infer<typeof WebhookPayloadSchema>
