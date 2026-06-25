export type InstanceStatus = 'connected' | 'disconnected' | 'qr_code'
export type MessageStatus = 'pending' | 'processing' | 'delivered' | 'failed' | 'skipped'
export type MessageRole = 'user' | 'assistant' | 'tool'
export type ConversationStatus = 'active' | 'closed'

export type BusinessHours = {
  [day in 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun']?: [string, string]
}

export interface Instance {
  id: string
  name: string
  evolution_instance_name: string
  webhook_secret: string
  status: InstanceStatus
  created_at: string
}

export interface Agent {
  id: string
  instance_id: string
  name: string
  model: string
  system_prompt: string
  temperature: number
  tools: string[]
  is_active: boolean
  business_hours: BusinessHours | null
  off_hours_message: string | null
  typing_delay_ms: number
  daily_message_limit: number | null
  created_at: string
}

export interface Contact {
  id: string
  instance_id: string
  phone: string
  name: string | null
  created_at: string
}

export interface Conversation {
  id: string
  contact_id: string
  instance_id: string
  agent_id: string | null
  status: ConversationStatus
  last_message_at: string | null
  created_at: string
}

export interface Message {
  id: string
  conversation_id: string
  role: MessageRole
  content: string
  status: MessageStatus
  error: string | null
  evolution_message_id: string | null
  created_at: string
}

export interface JobFailure {
  id: string
  message_id: string
  error: string
  attempts: number
  failed_at: string
}

export type MessageInsert = {
  conversation_id: string
  role: MessageRole
  content: string
  status?: MessageStatus
  evolution_message_id?: string
}

export type JobFailureInsert = {
  message_id: string
  error: string
  attempts: number
}

export interface Database {
  public: {
    Tables: {
      instances: {
        Row: Instance
        Insert: Omit<Instance, 'id' | 'created_at'>
        Update: Partial<Omit<Instance, 'id' | 'created_at'>>
      }
      agents: {
        Row: Agent
        Insert: Omit<Agent, 'id' | 'created_at'>
        Update: Partial<Omit<Agent, 'id' | 'created_at'>>
      }
      contacts: {
        Row: Contact
        Insert: Omit<Contact, 'id' | 'created_at'>
        Update: Partial<Omit<Contact, 'id' | 'created_at'>>
      }
      conversations: {
        Row: Conversation
        Insert: Omit<Conversation, 'id' | 'created_at'>
        Update: Partial<Omit<Conversation, 'id' | 'created_at'>>
      }
      messages: {
        Row: Message
        Insert: Omit<Message, 'id' | 'created_at'>
        Update: Partial<Omit<Message, 'id' | 'created_at'>>
      }
      job_failures: {
        Row: JobFailure
        Insert: Omit<JobFailure, 'id'>
        Update: Partial<Omit<JobFailure, 'id'>>
      }
    }
    Views: Record<string, never>
    Functions: Record<string, never>
    Enums: Record<string, never>
  }
}
