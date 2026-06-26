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

type Relationship = {
  foreignKeyName: string
  columns: string[]
  isOneToOne?: boolean
  referencedRelation: string
  referencedColumns: string[]
}

export interface Database {
  public: {
    Tables: {
      instances: {
        Row: { [K in keyof Instance]: Instance[K] }
        Insert: Omit<Instance, 'id' | 'created_at'>
        Update: Partial<Omit<Instance, 'id' | 'created_at'>>
        Relationships: Relationship[]
      }
      agents: {
        Row: { [K in keyof Agent]: Agent[K] }
        Insert: Omit<Agent, 'id' | 'created_at'>
        Update: Partial<Omit<Agent, 'id' | 'created_at'>>
        Relationships: Relationship[]
      }
      contacts: {
        Row: { [K in keyof Contact]: Contact[K] }
        Insert: Omit<Contact, 'id' | 'created_at'>
        Update: Partial<Omit<Contact, 'id' | 'created_at'>>
        Relationships: Relationship[]
      }
      conversations: {
        Row: { [K in keyof Conversation]: Conversation[K] }
        Insert: { contact_id: string; instance_id: string; agent_id: string | null; status: ConversationStatus; last_message_at?: string | null }
        Update: Partial<Omit<Conversation, 'id' | 'created_at'>>
        Relationships: Relationship[]
      }
      messages: {
        Row: { [K in keyof Message]: Message[K] }
        Insert: { conversation_id: string; role: MessageRole; content: string; status?: MessageStatus; error?: string | null; evolution_message_id?: string | null }
        Update: Partial<Omit<Message, 'id' | 'created_at'>>
        Relationships: Relationship[]
      }
      job_failures: {
        Row: { [K in keyof JobFailure]: JobFailure[K] }
        Insert: { message_id: string; error: string; attempts: number; failed_at?: string }
        Update: Partial<Omit<JobFailure, 'id'>>
        Relationships: Relationship[]
      }
    }
    Views: { [K in never]: never }
    Functions: { [K in never]: never }
    Enums: { [K in never]: never }
  }
}
