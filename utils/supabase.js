// Cliente Supabase do bot -- espelha trupe-site/lib/supabase.js (mesmo projeto Supabase, ver
// SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY no .env). Só usa a chave service_role: o bot roda
// inteiramente server-side e precisa ignorar Row Level Security pra gravar nas tabelas novas
// (jogadores, partidas, stats_partidas, advertencias, streamers, mixes) -- ver
// supabase/migrations/0001_jogadores_partidas_mixes.sql no trupe-site, que só liberou leitura
// pública via policy, escrita é só service_role mesmo.
const { createClient } = require('@supabase/supabase-js');

let client = null;

function getSupabase() {
  if (client) return client;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('Supabase não configurado: defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no .env.');
  }

  client = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
  return client;
}

module.exports = { getSupabase };
