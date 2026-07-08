export type InstanceStatus = 'connected' | 'disconnected' | 'qr_code'
export type MessageStatus = 'pending' | 'processing' | 'delivered' | 'failed' | 'skipped'
export type MessageRole = 'user' | 'assistant' | 'tool'
export type ConversationStatus = 'active' | 'closed' | 'paused'
export type ScheduledMessageStatus = 'pending' | 'sent' | 'failed'

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
  trigger_phrase: string | null
  created_at: string
}

export interface Contact {
  id: string
  instance_id: string
  phone: string
  name: string | null
  profile_picture_url: string | null
  is_group: boolean
  notes: string | null
  name_edited_by_user: boolean
  created_at: string
}

export interface Conversation {
  id: string
  contact_id: string
  instance_id: string
  agent_id: string | null
  status: ConversationStatus
  last_message_at: string | null
  agent_triggered: boolean
  unread_count: number
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
  media_path: string | null
  media_mimetype: string | null
  sender_phone: string | null
  sender_name: string | null
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

export interface ScheduledMessage {
  id: string
  conversation_id: string
  content: string
  media_base64: string | null
  media_type: 'text' | 'image' | 'audio'
  mimetype: string | null
  scheduled_at: string
  status: ScheduledMessageStatus
  error: string | null
  created_at: string
}

export type ScheduledMessageInsert = {
  conversation_id: string
  content: string
  media_base64?: string | null
  media_type?: 'text' | 'image' | 'audio'
  mimetype?: string | null
  scheduled_at: string
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
        Insert: Omit<Contact, 'id' | 'created_at' | 'profile_picture_url' | 'is_group' | 'notes' | 'name_edited_by_user'> & { profile_picture_url?: string | null; is_group?: boolean; notes?: string | null; name_edited_by_user?: boolean }
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
        Insert: { conversation_id: string; role: MessageRole; content: string; status?: MessageStatus; error?: string | null; evolution_message_id?: string | null; media_path?: string | null; media_mimetype?: string | null; sender_phone?: string | null; sender_name?: string | null }
        Update: Partial<Omit<Message, 'id' | 'created_at'>>
        Relationships: Relationship[]
      }
      job_failures: {
        Row: { [K in keyof JobFailure]: JobFailure[K] }
        Insert: { message_id: string; error: string; attempts: number; failed_at?: string }
        Update: Partial<Omit<JobFailure, 'id'>>
        Relationships: Relationship[]
      }
      scheduled_messages: {
        Row: { [K in keyof ScheduledMessage]: ScheduledMessage[K] }
        Insert: ScheduledMessageInsert
        Update: Partial<Omit<ScheduledMessage, 'id' | 'created_at'>>
        Relationships: Relationship[]
      }
    }
    Views: { [K in never]: never }
    Functions: {
      increment_unread_count: {
        Args: { conv_id: string }
        Returns: void
      }
    }
    Enums: { [K in never]: never }
  }
}
