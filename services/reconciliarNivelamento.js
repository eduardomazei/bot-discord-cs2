// Reconciliação do NIVELAMENTO decidido pelo site (trupe-site /admin/nivelamento).
//
// O ADM revisa lá quando o Elo de alguém cruza uma fronteira de rank e decide "aplicar" ou
// "manter" — mas o site não consegue mudar o apelido no Discord. Quando aplica, ele grava o
// novo rank_trupe (Sheet + Supabase) e marca `nick_sync_pendente = true` no Supabase; este
// job varre essa flag (poll barato, só Supabase) e, pra cada acerto, sincroniza o apelido de
// verdade (Sheet + Discord) usando a mesma lógica do /rankear (reconciliarNick).
//
// Regra de ouro (igual aos outros services): nada aqui pode derrubar o processo. Só log.
const { getSupabase } = require('../utils/supabase');
const { getSheet } = require('../utils/sheets');
const { reconciliarNick } = require('./rankNickService');
const { sincronizarRankNick } = require('./supabaseSyncService');

const INTERVALO_MS = 3 * 60 * 1000;
const PAUSA_ENTRE_MS = 800;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function processar(client) {
  let sb;
  try {
    sb = getSupabase();
  } catch {
    return; // Supabase não configurado neste ambiente — silencioso, mesma regra dos syncs.
  }

  const guild = client.guilds.cache.get(process.env.GUILD_ID)
    || (process.env.GUILD_ID ? await client.guilds.fetch(process.env.GUILD_ID).catch(() => null) : null);
  if (!guild) return;

  const { data: pendentes, error } = await sb
    .from('jogadores')
    .select('discord_id')
    .eq('nick_sync_pendente', true)
    .limit(20);
  if (error) {
    console.error('[reconciliar-nivelamento] erro ao buscar pendentes:', error.message);
    return;
  }
  if (!pendentes || pendentes.length === 0) return;

  // Só carrega a planilha inteira (custa cota do Sheets) se realmente tem alguém pra
  // sincronizar — em condições normais essa lista está vazia na maioria dos ticks.
  let sheet, rows;
  try {
    sheet = await getSheet('Jogadores');
    rows = await sheet.getRows();
  } catch (err) {
    console.error('[reconciliar-nivelamento] erro ao ler a planilha:', err.message);
    return;
  }
  const rowPorId = new Map(rows.map((r) => [r.get('discord_id'), r]));

  for (const { discord_id: discordId } of pendentes) {
    const row = rowPorId.get(discordId);
    if (!row) {
      // Linha sumiu da planilha (não deveria acontecer) — limpa a flag pra não ficar preso.
      await sb.from('jogadores').update({ nick_sync_pendente: false }).eq('discord_id', discordId);
      continue;
    }

    try {
      const member = await guild.members.fetch(discordId).catch(() => null);
      const res = await reconciliarNick(member, row);

      if (res.status === 'renomeado' || res.status === 'ja_ok' || res.status === 'sem_permissao') {
        await row.save();
        await sincronizarRankNick({
          discordId,
          nome: row.get('nome'),
          rankTrupe: row.get('rank_trupe'),
          discordNick: row.get('discord_nick'),
        });
      }
      if (res.status === 'sem_permissao') {
        console.warn(`[reconciliar-nivelamento] ${discordId} não pôde ser renomeado (dono/hierarquia) — a planilha já está certa, só o nick no Discord fica desatualizado até um ADM ajustar a hierarquia ou renomear na mão.`);
      } else if (res.status === 'renomeado') {
        console.log(`[reconciliar-nivelamento] ${discordId}: apelido → ${res.para}`);
      }
      // Best-effort: mesmo 'ausente' (saiu do servidor) ou 'erro' encerra a pendência aqui —
      // rank_trupe/Sheet já está certo, o apelido eventualmente reconcilia num próximo evento.
      await sb.from('jogadores').update({ nick_sync_pendente: false }).eq('discord_id', discordId);
    } catch (err) {
      console.error(`[reconciliar-nivelamento] falha ao processar ${discordId}:`, err.message);
    }
    await dormir(PAUSA_ENTRE_MS);
  }
}

function iniciarReconciliacaoNivelamento(client) {
  const tick = () => processar(client).catch((e) => console.error('[reconciliar-nivelamento]', e));
  tick();
  setInterval(tick, INTERVALO_MS);
  console.log('📶 Reconciliação de nivelamento de rank iniciada (a cada 3min).');
}

module.exports = { iniciarReconciliacaoNivelamento };
