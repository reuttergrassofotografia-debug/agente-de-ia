export { createSupabaseClient } from './client.js'
export type {
  Database, Instance, Agent, Contact, Conversation, Message, JobFailure,
  MessageInsert, JobFailureInsert, BusinessHours,
  InstanceStatus, MessageStatus, MessageRole, ConversationStatus,
} from './types.js'
export { getInstanceByName, updateInstanceStatus } from './queries/instances.js'
export { getAgentByInstanceId } from './queries/agents.js'
export { getOrCreateContact } from './queries/contacts.js'
export { getOrCreateConversation } from './queries/conversations.js'
export { createMessage, updateMessageStatus, getConversationMessages, createJobFailure } from './queries/messages.js'
