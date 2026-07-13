import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'

export function createServiceClient(): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL') ?? ''
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  if (!url || !key) {
    throw new Error('SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY são obrigatórios na Edge Function.')
  }
  return createClient(url, key, { auth: { persistSession: false } })
}
