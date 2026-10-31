declare const process: { env: Record<string, string | undefined> };

/** Injected at build time (see scripts/build.ts). Only the public anon key belongs here. */
export const SUPABASE_URL: string = process.env.DAMEO_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY: string = process.env.DAMEO_SUPABASE_ANON_KEY ?? '';

export const backendConfigured: boolean = /^https?:\/\/.+/.test(SUPABASE_URL) && SUPABASE_ANON_KEY.length > 20;
