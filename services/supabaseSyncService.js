// Dual-write pro Supabase -- passo 2 do plano de migração Sheets -> Supabase (ver ADR/plano na
// memória do projeto trupe-site). Google Sheets continua sendo a fonte da verdade nesta fase;
// isso aqui só manda uma CÓPIA em paralelo pra validar o banco novo com dados reais de mix,
// sem trocar nada do que já funciona.
//
// Regra de ouro: nenhuma função daqui pode derrubar o comando que a chamou. Toda escrita no
// Sheets tem que ter acontecido e sido confirmada ANTES de chamar isso, e qualquer erro aqui é
// só logado -- nunca propagado pra quem chamou (ver uso em legacy/interactionRouter.js,
// modal_registrar_).
const { getSupabase } = require('../utils/supabase');
const { nomeLimpo } = require('../utils/ranks');

/**
 * Espelha o upsert que o modal de /registrar já faz na aba "Jogadores" -- mesma regra de só
 * sobrescrever link_faceit/link_gc quando um valor de verdade foi digitado (não some o que já
 * tinha se o campo do modal ficou em branco / "N/A").
 * @param {{discordId: string, discordNick: string, steamid64: string, linkFaceit?: string, linkGc?: string}} dados
 */
async function sincronizarJogadorRegistro({ discordId, discordNick, steamid64, linkFaceit, linkGc }) {
  try {
    const supabase = getSupabase();

    const payload = {
      discord_id: discordId,
      discord_nick: discordNick,
      // nome limpo (sem tag de rank) espelha a coluna nova da aba Jogadores -- rank_trupe
      // fica de fora: cadastro novo nasce sem rank até a administração usar /rankear.
      nome: nomeLimpo(discordNick) || discordNick,
      steamid64,
    };
    if (linkFaceit && linkFaceit !== 'N/A') payload.link_faceit = linkFaceit;
    if (linkGc && linkGc !== 'N/A') payload.link_gc = linkGc;

    const { error } = await supabase.from('jogadores').upsert(payload, { onConflict: 'discord_id' });
    if (error) throw error;
  } catch (error) {
    // Só log -- ver regra de ouro no topo do arquivo. O cadastro no Sheets (fonte da verdade
    // nesta fase) já foi salvo antes dessa chamada, então a pessoa nunca percebe isso falhar.
    console.error('[dual-write] Falha ao sincronizar jogador no Supabase:', error.message);
  }
}

/**
 * Espelha a tag de rank / nome limpo em "jogadores" -- chamado pelo /rankear e pelo
 * rename automático pós-partida (services/rankNickService.js). `elo` só vem do /rankear
 * (que pode reposicionar o Elo na faixa do rank); o rename pós-partida não mexe no Elo
 * aqui (o acumulado já foi sincronizado por sincronizarPartida()).
 * @param {{discordId: string, nome?: string, rankTrupe?: string, discordNick?: string, elo?: number}} dados
 */
async function sincronizarRankNick({ discordId, nome, rankTrupe, discordNick, elo }) {
  try {
    const supabase = getSupabase();
    const payload = { discord_id: discordId };
    if (nome !== undefined) payload.nome = nome;
    if (rankTrupe !== undefined) payload.rank_trupe = rankTrupe;
    if (discordNick !== undefined) payload.discord_nick = discordNick;
    if (elo !== undefined && elo !== null) payload.elo = elo;

    const { error } = await supabase.from('jogadores').upsert(payload, { onConflict: 'discord_id' });
    if (error) throw error;
  } catch (error) {
    console.error('[dual-write] Falha ao sincronizar rank/nick no Supabase:', error.message);
  }
}

/**
 * Garante que o jogador existe em "jogadores" (cria um registro mínimo se ele nunca tiver
 * passado por /registrar -- mesmo comportamento do sheetJogadores.addRow(...) em
 * utils/advertencias.js quando a linha ainda não existe) e aplica o estado de moderação
 * atual. Chamado tanto por /advertir e /ausente quanto por /desadvertir.
 */
async function garantirJogadorEAtualizarModeracao({ discordId, discordNick, pontosAdvertencia, punicoes, banidoAte, banidoTemporada }) {
  const supabase = getSupabase();

  // 1) Só cria a linha se ela não existir -- ignoreDuplicates vira no-op quando já existe, sem
  // sobrescrever discord_nick com um valor possivelmente desatualizado (mesma cautela do Sheets:
  // discord_nick só é gravado na hora de CRIAR a linha, nunca depois).
  const { error: createError } = await supabase
    .from('jogadores')
    .upsert({ discord_id: discordId, discord_nick: discordNick }, { onConflict: 'discord_id', ignoreDuplicates: true });
  if (createError) throw createError;

  // 2) pontos_advertencia/punicoes sempre são atualizados. banido_ate/banido_temporada só entram
  // no payload quando o chamador passou um valor de verdade (não undefined) -- mesma cautela do
  // Sheets, que só toca essas duas colunas quando uma punição NOVA é cruzada (ver
  // utils/advertencias.js), não em toda advertência aplicada.
  const payload = { pontos_advertencia: pontosAdvertencia, punicoes };
  if (banidoAte !== undefined) payload.banido_ate = banidoAte;
  if (banidoTemporada !== undefined) payload.banido_temporada = banidoTemporada;

  const { error: updateError } = await supabase.from('jogadores').update(payload).eq('discord_id', discordId);
  if (updateError) throw updateError;
}

/**
 * Espelha registrarAdvertencia() em utils/advertencias.js: atualiza o cache de moderação em
 * "jogadores" E grava o evento em "advertencias" -- esse histórico por evento (data, motivo,
 * quem aplicou) é a melhoria de verdade sobre o Sheets, que só guarda o total acumulado.
 */
async function sincronizarAdvertencia({ discordId, discordNick, pontosAdvertencia, punicoes, banidoAte, banidoTemporada, tipo, motivo, pontosAplicados, aplicadoPorDiscordId }) {
  try {
    await garantirJogadorEAtualizarModeracao({ discordId, discordNick, pontosAdvertencia, punicoes, banidoAte, banidoTemporada });

    const supabase = getSupabase();
    const { error } = await supabase.from('advertencias').insert({
      jogador_discord_id: discordId,
      tipo,
      motivo,
      pontos: pontosAplicados,
      aplicado_por_discord_id: aplicadoPorDiscordId,
      // Advertência aplicada pelo próprio bot: a DM já foi mandada em utils/advertencias.js.
      // dm_enviada = true impede que o polling do site (services/advertenciaDmService.js) mande
      // uma segunda DM pra mesma advertência.
      dm_enviada: true,
    });
    if (error) throw error;
  } catch (error) {
    // Ver regra de ouro no topo do arquivo -- inclui o caso de aplicado_por_discord_id apontar
    // pra um admin que nunca rodou /registrar (FK falha, história desse evento fica só no
    // Sheets); o cache de moderação do alvo já foi tentado separadamente acima.
    console.error('[dual-write] Falha ao sincronizar advertência no Supabase:', error.message);
  }
}

/**
 * Espelha /desadvertir: só atualiza o cache de moderação (não existe um "tipo" de remoção pra
 * logar em "advertencias" -- desadvertir corrige/zera o total, não é um evento com motivo).
 */
async function sincronizarDesadvertir({ discordId, discordNick, pontosAdvertencia, punicoes, banidoAte, banidoTemporada }) {
  try {
    await garantirJogadorEAtualizarModeracao({ discordId, discordNick, pontosAdvertencia, punicoes, banidoAte, banidoTemporada });
  } catch (error) {
    console.error('[dual-write] Falha ao sincronizar remoção de advertência no Supabase:', error.message);
  }
}

/**
 * Find-or-create em "mixes" pelo mix_id digitado no /importar-partida. mix_id é texto livre sem
 * validação de formato (ex: "2026-08-18", mas pode ser qualquer coisa digitada errado) -- por
 * isso vira "raw_label" (chave de find-or-create real, ver 0002_mixes_raw_label.sql) em vez de
 * tentar casar contra a coluna "data". "data" é só preenchida na criação: tenta interpretar
 * raw_label como data de calendário e cai pro dia de hoje se não der.
 * @returns {Promise<string|null>} id do mix, ou null se mixId veio vazio.
 */
async function encontrarOuCriarMix(supabase, mixId) {
  if (!mixId) return null;

  const { data: existente, error: buscaError } = await supabase
    .from('mixes')
    .select('id')
    .eq('raw_label', mixId)
    .maybeSingle();
  if (buscaError) throw buscaError;
  if (existente) return existente.id;

  const dataDigitada = new Date(mixId);
  const data = isNaN(dataDigitada.getTime()) ? new Date() : dataDigitada;

  // Best-effort -- se não houver temporada ativa cadastrada ainda (ver seasons.ativa em 0001),
  // o mix simplesmente nasce sem season_id em vez de travar a criação.
  const { data: temporadaAtiva } = await supabase.from('seasons').select('id').eq('ativa', true).maybeSingle();

  const { data: criado, error: criaError } = await supabase
    .from('mixes')
    .insert({ raw_label: mixId, data: data.toISOString().slice(0, 10), season_id: temporadaAtiva ? temporadaAtiva.id : null })
    .select('id')
    .single();
  if (criaError) throw criaError;
  return criado.id;
}

/**
 * Espelha gravarPartida() -- as 3 escritas do Sheets (Stats_Partidas, acumulado em Jogadores,
 * resumo em Partidas) viram: find-or-create do mix, 1 insert em "partidas", N inserts em
 * "stats_partidas" (statsRowsSupabase, já tipado por calcularPartida()) e 1 update em
 * "jogadores" por participante cadastrado. Chamado só depois que a gravação no Sheets (fonte da
 * verdade nesta fase) já terminou -- ver uso em firegamesService.js/gravarPartida().
 */
async function sincronizarPartida(pending) {
  try {
    const supabase = getSupabase();

    const mixId = await encontrarOuCriarMix(supabase, pending.mixId);

    const { data: partidaInserida, error: partidaError } = await supabase
      .from('partidas')
      .insert({
        matchid: pending.matchId,
        server_id: pending.serverId,
        mix_id: mixId,
        rodada: pending.rodada,
        mapa: pending.mapa,
        team_a_cor: pending.corTimeA,
        team_b_cor: pending.corTimeB,
        team_winner: pending.teamWinner,
        score_a: pending.scoreA,
        score_b: pending.scoreB,
        mvp_discord_id: pending.mvpDiscordId,
        mvp_nome_raw: pending.mvpNomeRaw,
        link_demo_and_stats: pending.directFileLink,
      })
      .select('id')
      .single();
    if (partidaError) throw partidaError;

    if (pending.statsRowsSupabase.length > 0) {
      const linhas = pending.statsRowsSupabase.map(l => ({ ...l, partida_id: partidaInserida.id }));
      const { error: statsError } = await supabase.from('stats_partidas').insert(linhas);
      if (statsError) throw statsError;
    }

    // Acumulado por jogador cadastrado -- cada update é isolado (não aborta os outros
    // jogadores da partida se um falhar, ex: FK apontando pra um discord_id nunca sincronizado).
    for (const upd of pending.jogadorUpdates) {
      const { error: updError } = await supabase
        .from('jogadores')
        .update({
          elo: upd.novoElo,
          partidas_jogadas: upd.novoMatchs,
          ...(upd.incrementaVitoria ? { vitorias: upd.novoWins } : {}),
          kills: upd.novoKills,
          deaths: upd.novoDeaths,
          assists: upd.novoAssists,
          head_shot_kills: upd.novoHs,
          damage: upd.novoDamage,
        })
        .eq('discord_id', upd.discordId);
      if (updError) {
        console.error(`[dual-write] Falha ao sincronizar acumulado do jogador ${upd.discordId} no Supabase:`, updError.message);
      }
    }
  } catch (error) {
    // Ver regra de ouro no topo do arquivo -- inclui find-or-create do mix e o insert de
    // partidas/stats_partidas falhando (ex: matchid+server_id colidindo por uma corrida rara).
    console.error('[dual-write] Falha ao sincronizar partida no Supabase:', error.message);
  }
}

module.exports = { sincronizarJogadorRegistro, sincronizarRankNick, sincronizarAdvertencia, sincronizarDesadvertir, sincronizarPartida };
