export const MESSAGE_QUEUE_NAME = 'messages' as const

export interface MessageJob {
  instanceId: string
  contactId: string
  messageId: string
  conversationId: string
  evolutionInstanceName: string
  contactPhone: string
  conversationTriggered: boolean
}
