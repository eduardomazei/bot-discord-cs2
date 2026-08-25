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

module.exports = { sincronizarJogadorRegistro, sincronizarAdvertencia, sincronizarDesadvertir };
