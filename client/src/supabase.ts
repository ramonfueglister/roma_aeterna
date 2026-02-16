import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { ProvinceData } from './types';

export interface SupabaseClientConfig {
  url: string;
  anonKey: string;
}

export function getSupabaseEnvConfig(): SupabaseClientConfig | null {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

  if (!url || !key) {
    return null;
  }

  return { url, anonKey: key };
}

export function createSupabaseClient(config: SupabaseClientConfig): SupabaseClient {
  return createClient(config.url, config.anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

const runtimeConfig = getSupabaseEnvConfig();

export const hasSupabaseConfig = Boolean(runtimeConfig);

export const supabase: SupabaseClient | null = hasSupabaseConfig
  ? createSupabaseClient(runtimeConfig!)
  : null;

export async function testSupabaseConnection(
  client: SupabaseClient | null = supabase,
): Promise<boolean> {
  if (!client) {
    return false;
  }

  try {
    const { error } = await client.from('world_state').select('id').eq('id', 1).limit(1);
    return !error;
  } catch {
    return false;
  }
}

export async function fetchProvinces(
  client: SupabaseClient | null = supabase,
): Promise<ProvinceData[]> {
  if (!client) {
    return [];
  }

  try {
    const { data, error } = await client
      .from('provinces')
      .select('id,name,latin_name,culture,capital_city_id,color');

    if (error || !data) {
      return [];
    }

    return data.map((row) => ({
      id: row.id,
      name: row.name,
      latinName: row.latin_name,
      culture: row.culture,
      capitalCityId: row.capital_city_id,
      color: row.color,
    }));
  } catch {
    return [];
  }
}
