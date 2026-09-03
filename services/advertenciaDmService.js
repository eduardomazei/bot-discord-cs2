// Polling das advertências aplicadas PELO SITE (trupe-site /admin/moderacao). O site grava em
// `advertencias` no Supabase mas não fala com o Discord — quem manda a DM pro jogador é o bot,
// aqui. Linhas com dm_enviada = false são as que ainda não foram avisadas.
//
// Advertências aplicadas pelo próprio bot (/advertir, /ausente) já mandam a DM na hora e
// gravam dm_enviada = true (ver utils/advertencias.js), então nunca aparecem aqui.
const { getSupabase } = require('../utils/supabase');
const { enviarNotificacaoDM } = require('./notificacoesService');
const { CORES } = require('../utils/colors');
const { BANNERS } = require('../utils/banners');

const INTERVALO_MS = 60 * 1000;

const TIPO_LABEL = {
  falta_atraso: 'Falta ou Atraso',
  falta_respeito: 'Falta de Respeito com ADM/Staff',
  ragequit_troll: 'Ragequit ou Troll',
};

async function processarPendentes(client) {
  let sb;
  try {
    sb = getSupabase();
  } catch {
    return; // Supabase não configurado neste ambiente — silencioso, mesma regra dos syncs.
  }

  const { data: pendentes, error } = await sb
    .from('advertencias')
    .select('id, jogador_discord_id, tipo, motivo, pontos, criado_em')
    .eq('dm_enviada', false)
    .order('criado_em', { ascending: true })
    .limit(20);
  if (error) {
    console.error('[advertenciaDm] erro ao buscar pendentes:', error.message);
    return;
  }
  if (!pendentes || pendentes.length === 0) return;

  for (const adv of pendentes) {
    const { data: jog } = await sb
      .from('jogadores')
      .select('pontos_advertencia, banido_ate, banido_temporada')
      .eq('discord_id', adv.jogador_discord_id)
      .maybeSingle();

    const label = TIPO_LABEL[adv.tipo] || adv.tipo;
    let statusPunicao = '<:trupe_sucesso:1536412279778574356> Nenhuma punição aplicada ainda.';
    if (jog?.banido_temporada) {
      statusPunicao = '🚫 **PUNIÇÃO APLICADA!** Você está banido do Mix até o fim da temporada atual.';
    } else if (jog?.banido_ate) {
      const ate = new Date(jog.banido_ate);
      if (!Number.isNaN(ate.getTime()) && ate.getTime() > Date.now()) {
        statusPunicao = `🚫 **PUNIÇÃO APLICADA!** Você está banido do Mix até <t:${Math.floor(ate.getTime() / 1000)}:F>.`;
      }
    }

    await enviarNotificacaoDM(client, adv.jogador_discord_id, {
      bannerKey: BANNERS.ADVERTENCIA,
      cor: CORES.ERRO,
      titulo: '<:trupe_aviso:1536410370829328434> Você recebeu uma advertência',
      corpo:
        `**Tipo**: ${label} (+${adv.pontos} pts)\n` +
        `**Motivo**: ${adv.motivo || label}\n` +
        `**Pontos totais**: ${jog?.pontos_advertencia ?? '?'} pts\n\n` +
        statusPunicao,
    });

    // Marca como enviada mesmo se a DM falhou (DM fechada é normal — não fica retentando
    // pra sempre a mesma linha).
    const { error: updErr } = await sb.from('advertencias').update({ dm_enviada: true }).eq('id', adv.id);
    if (updErr) console.error('[advertenciaDm] erro ao marcar dm_enviada:', updErr.message);
  }
}

function iniciarPollingAdvertencias(client) {
  const tick = () => processarPendentes(client).catch((e) => console.error('[advertenciaDm]', e));
  tick();
  setInterval(tick, INTERVALO_MS);
  console.log('📨 Polling de advertências do site iniciado (a cada 60s).');
}

module.exports = { iniciarPollingAdvertencias };
