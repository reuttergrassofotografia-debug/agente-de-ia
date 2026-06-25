import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Database } from './types.js'

export function createSupabaseClient(): SupabaseClient<Database> {
  const url = process.env['SUPABASE_URL']
  const key = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  return createClient<Database>(url, key)
}
