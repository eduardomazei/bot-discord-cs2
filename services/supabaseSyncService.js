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

module.exports = { sincronizarJogadorRegistro };
