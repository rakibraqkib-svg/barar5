import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { normalizeSupabaseUrl, normalizeSupabaseAnonKey } from '../utils/pinSecurity';

// Environment variables (compiled at build time from .env / Vercel Env Vars) or localStorage saved credentials
const RAW_ENV_URL = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_SUPABASE_URL) || '';
const RAW_ENV_ANON_KEY = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_SUPABASE_ANON_KEY) || '';

// Connected public Supabase project credentials (anon public key protected by PostgreSQL RLS)
const DEFAULT_SUPABASE_URL = 'https://jniyvettzuctyiqmgvxk.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImpuaXl2ZXR0enVjdHlpcW1ndnhrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQzODI3MjAsImV4cCI6MjEwOTk1ODcyMH0.AhCKDF0o5N519MnKFXCZP2rFxatn6936BKLS4_b8NBk';

const ENV_URL = normalizeSupabaseUrl(RAW_ENV_URL);
const ENV_ANON_KEY = normalizeSupabaseAnonKey(RAW_ENV_ANON_KEY);

let supabaseInstance: SupabaseClient | null = null;
let cachedCredKey = '';

export function getSupabaseCredentials(): {
  url: string;
  anonKey: string;
  isConfigured: boolean;
  fromEnv: boolean;
  fromDefault: boolean;
} {
  // 1. Prefer build-time env vars (Vercel Env Vars)
  if (ENV_URL && ENV_ANON_KEY) {
    return {
      url: ENV_URL,
      anonKey: ENV_ANON_KEY,
      isConfigured: true,
      fromEnv: true,
      fromDefault: false,
    };
  }

  // 2. Check manually saved localStorage config
  try {
    const saved = localStorage.getItem('bazarbd_supabase_config_v1');
    if (saved) {
      const parsed = JSON.parse(saved);
      const savedUrl = normalizeSupabaseUrl(parsed.supabaseUrl);
      const savedKey = normalizeSupabaseAnonKey(parsed.supabaseAnonKey);
      if (savedUrl && savedKey) {
        return {
          url: savedUrl,
          anonKey: savedKey,
          isConfigured: true,
          fromEnv: false,
          fromDefault: false,
        };
      }
    }
  } catch (e) {
    console.error(e);
  }

  // 3. Built-in connected Supabase project fallback (works on Vercel out-of-the-box even after cookie clears)
  return {
    url: DEFAULT_SUPABASE_URL,
    anonKey: DEFAULT_SUPABASE_ANON_KEY,
    isConfigured: true,
    fromEnv: false,
    fromDefault: true,
  };
}

export function getSupabaseEnvDiagnostics(): {
  hasRawEnvUrl: boolean;
  hasValidEnvUrl: boolean;
  hasEnvKey: boolean;
  fromEnv: boolean;
  fromDefault: boolean;
  isConfigured: boolean;
  host: string;
} {
  const creds = getSupabaseCredentials();
  let host = '';
  if (creds.url) {
    try {
      host = new URL(creds.url).hostname;
    } catch {
      host = '';
    }
  }
  return {
    hasRawEnvUrl: Boolean(RAW_ENV_URL && String(RAW_ENV_URL).trim()),
    hasValidEnvUrl: Boolean(ENV_URL),
    hasEnvKey: Boolean(ENV_ANON_KEY),
    fromEnv: creds.fromEnv,
    fromDefault: creds.fromDefault,
    isConfigured: creds.isConfigured,
    host,
  };
}

export function resetSupabaseClientCache() {
  supabaseInstance = null;
  cachedCredKey = '';
}

export function getSupabaseClient(): SupabaseClient | null {
  const { url, anonKey, isConfigured } = getSupabaseCredentials();
  if (!isConfigured) return null;

  const key = `${url}::${anonKey}`;
  if (!supabaseInstance || cachedCredKey !== key) {
    try {
      supabaseInstance = createClient(url, anonKey);
      cachedCredKey = key;
    } catch (e) {
      console.error('Failed to initialize Supabase client:', e);
      return null;
    }
  }
  return supabaseInstance;
}

export async function testSupabaseConnection(rawUrl: string, rawAnonKey: string): Promise<{ success: boolean; message: string; tablesExist: boolean }> {
  const url = normalizeSupabaseUrl(rawUrl);
  const anonKey = normalizeSupabaseAnonKey(rawAnonKey);
  if (!url || !anonKey) {
    return {
      success: false,
      message: 'সঠিক Supabase Project URL (https://...supabase.co) এবং Anon/Publishable Key প্রদান করুন।',
      tablesExist: false,
    };
  }

  try {
    const tempClient = createClient(url, anonKey);
    // Probe bazarbd_kv_store first
    const { error } = await tempClient.from('bazarbd_kv_store').select('key').limit(1);

    if (error) {
      if (
        error.code === '42P01' ||
        error.code === 'PGRST205' ||
        error.message.includes('does not exist') ||
        error.message.includes('Could not find the table')
      ) {
        return {
          success: true,
          message: 'Supabase প্রজেক্টে কানেক্ট হয়েছে! তবে bazarbd_kv_store টেবিল এখনো তৈরি হয়নি। নিচের SQL স্ক্রিপ্টটি কপি করে Supabase SQL Editor-এ Run করুন।',
          tablesExist: false,
        };
      }
      return {
        success: false,
        message: `Connection error: ${error.message}`,
        tablesExist: false,
      };
    }

    return {
      success: true,
      message: 'Supabase কানেকশন ও স্থায়ী ডাটাবেজ টেবিল (bazarbd_kv_store) সফলভাবে সংযুক্ত হয়েছে!',
      tablesExist: true,
    };
  } catch (err: any) {
    return {
      success: false,
      message: err.message || 'Could not connect to Supabase endpoint',
      tablesExist: false,
    };
  }
}
