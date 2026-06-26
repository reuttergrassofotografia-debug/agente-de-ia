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

// Explicit Insert/Update types for Database (avoids Omit/Partial in generic constraints)
type InstanceInsert = { name: string; evolution_instance_name: string; webhook_secret: string; status: InstanceStatus }
type InstanceUpdate = { name?: string; evolution_instance_name?: string; webhook_secret?: string; status?: InstanceStatus }

type AgentInsert = { instance_id: string; name: string; model: string; system_prompt: string; temperature: number; tools: string[]; is_active: boolean; business_hours?: BusinessHours | null; off_hours_message?: string | null; typing_delay_ms: number; daily_message_limit?: number | null }
type AgentUpdate = { instance_id?: string; name?: string; model?: string; system_prompt?: string; temperature?: number; tools?: string[]; is_active?: boolean; business_hours?: BusinessHours | null; off_hours_message?: string | null; typing_delay_ms?: number; daily_message_limit?: number | null }

type ContactInsert = { instance_id: string; phone: string; name?: string | null }
type ContactUpdate = { instance_id?: string; phone?: string; name?: string | null }

type ConversationInsert = { contact_id: string; instance_id: string; agent_id?: string | null; status: ConversationStatus; last_message_at?: string | null }
type ConversationUpdate = { contact_id?: string; instance_id?: string; agent_id?: string | null; status?: ConversationStatus; last_message_at?: string | null }

type MessageRow = { id: string; conversation_id: string; role: MessageRole; content: string; status: MessageStatus; error: string | null; evolution_message_id: string | null; created_at: string }
type MessageInsertRow = { conversation_id: string; role: MessageRole; content: string; status?: MessageStatus; error?: string | null; evolution_message_id?: string | null }
type MessageUpdate = { conversation_id?: string; role?: MessageRole; content?: string; status?: MessageStatus; error?: string | null; evolution_message_id?: string | null }

type JobFailureInsertRow = { message_id: string; error: string; attempts: number }
type JobFailureUpdate = { message_id?: string; error?: string; attempts?: number }

export interface Database {
  public: {
    Tables: {
      instances: {
        Row: Instance
        Insert: InstanceInsert
        Update: InstanceUpdate
        Relationships: []
      }
      agents: {
        Row: Agent
        Insert: AgentInsert
        Update: AgentUpdate
        Relationships: []
      }
      contacts: {
        Row: Contact
        Insert: ContactInsert
        Update: ContactUpdate
        Relationships: []
      }
      conversations: {
        Row: Conversation
        Insert: ConversationInsert
        Update: ConversationUpdate
        Relationships: []
      }
      messages: {
        Row: MessageRow
        Insert: MessageInsertRow
        Update: MessageUpdate
        Relationships: []
      }
      job_failures: {
        Row: JobFailure
        Insert: JobFailureInsertRow
        Update: JobFailureUpdate
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: { [_ in never]: never }
    Enums: { [_ in never]: never }
  }
}
