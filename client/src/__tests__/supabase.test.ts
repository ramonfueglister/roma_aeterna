import { afterEach, describe, expect, it, vi } from 'vitest';

const { createClientMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: createClientMock,
}));

import {
  createSupabaseClient,
  fetchProvinces,
  getSupabaseEnvConfig,
  testSupabaseConnection,
} from '../supabase';

describe('supabase integration', () => {
  afterEach(() => {
    createClientMock.mockReset();
  });

  it('returns null config when env vars are missing', () => {
    // In test env, import.meta.env.VITE_SUPABASE_URL is not set
    const config = getSupabaseEnvConfig();
    expect(config).toBeNull();
  });

  it('creates a Supabase client with required auth settings', () => {
    createClientMock.mockReturnValue({ from: vi.fn() });

    createSupabaseClient({ url: 'https://demo.example', anonKey: 'demo-key' });

    expect(createClientMock).toHaveBeenCalledWith('https://demo.example', 'demo-key', {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  });

  it('returns true when client probe succeeds', async () => {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ error: null }),
    };
    const client = { from: vi.fn().mockReturnValue(query) };

    const ok = await testSupabaseConnection(client as never);
    expect(ok).toBe(true);
    expect(query.select).toHaveBeenCalledWith('id');
    expect(query.eq).toHaveBeenCalledWith('id', 1);
    expect(query.limit).toHaveBeenCalledWith(1);
  });

  it('returns false when client probe fails', async () => {
    const query = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue({ error: new Error('db unavailable') }),
    };
    const client = { from: vi.fn().mockReturnValue(query) };

    const ok = await testSupabaseConnection(client as never);
    expect(ok).toBe(false);
  });

  it('returns false when no client provided', async () => {
    const ok = await testSupabaseConnection(null);
    expect(ok).toBe(false);
  });

  it('fetches provinces and maps database fields', async () => {
    const query = {
      select: vi.fn().mockResolvedValue({
        data: [
          {
            id: 1,
            name: 'Italia',
            latin_name: 'Italia',
            culture: 'roman',
            capital_city_id: 'roma',
            color: 16711680,
          },
        ],
        error: null,
      }),
    };
    const client = { from: vi.fn().mockReturnValue(query) };

    const provinces = await fetchProvinces(client as never);

    expect(client.from).toHaveBeenCalledWith('provinces');
    expect(query.select).toHaveBeenCalledWith('id,name,latin_name,culture,capital_city_id,color');
    expect(provinces).toEqual([
      {
        id: 1,
        name: 'Italia',
        latinName: 'Italia',
        culture: 'roman',
        capitalCityId: 'roma',
        color: 16711680,
      },
    ]);
  });

  it('returns empty list when province fetch fails', async () => {
    const query = {
      select: vi.fn().mockResolvedValue({
        data: null,
        error: new Error('db unavailable'),
      }),
    };
    const client = { from: vi.fn().mockReturnValue(query) };

    const provinces = await fetchProvinces(client as never);

    expect(provinces).toEqual([]);
  });

  it('returns empty list when no client provided', async () => {
    const provinces = await fetchProvinces(null);
    expect(provinces).toEqual([]);
  });
});
