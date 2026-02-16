import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const hasSupabaseConfig = Boolean(url && key);

const createFallbackClient = (): null => null;

export const supabase: SupabaseClient | null = hasSupabaseConfig
  ? createClient(url as string, key as string, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  : createFallbackClient();

export async function testSupabaseConnection(): Promise<boolean> {
  if (!supabase) {
    return false;
  }

  try {
    const { error } = await supabase.from('world_state').select('id').eq('id', 1).limit(1);
    return !error;
  } catch {
    return false;
  }
}
