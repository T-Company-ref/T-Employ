function getConfig() {
  const c = window.__TBELL_EMPLOY_CONFIG__ || {};
  return {
    url: (c.supabaseUrl || "").trim(),
    anonKey: (c.supabaseAnonKey || "").trim(),
  };
}

export function configReady() {
  const { url, anonKey } = getConfig();
  return Boolean(url && anonKey && window.supabase);
}

export function createClient() {
  const { url, anonKey } = getConfig();
  if (!url || !anonKey) {
    throw new Error("SUPABASE_URL / SUPABASE_ANON_KEY 가 없습니다. web/config.js 를 설정하세요.");
  }
  if (!window.supabase?.createClient) {
    throw new Error("Supabase JS CDN 로드 실패");
  }
  return window.supabase.createClient(url, anonKey, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  });
}
