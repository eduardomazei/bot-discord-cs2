// Mantém o apelido do Discord em sincronia com o rank CONFIRMADO (rank_trupe) do jogador.
//
// Até 2026-09-11 esse serviço também DECIDIA o rank (rank_trupe = obterRank(elo), sempre que
// o Elo cruzava uma fronteira numa partida importada) -- agora rank_trupe só muda por
// /rankear (admin, aqui no bot) ou pela aba /admin/nivelamento no site (o ADM revisa cada
// cruzamento e decide aplicar ou manter). Este arquivo só cuida do apelido: dado o
// rank_trupe que já está gravado, garante que o nick do Discord bate com ele. Quem chama:
//   - /rankear (commands/jogadores/rankear.js) -- renomeia na hora, não passa por aqui
//   - services/reconciliarNivelamento.js -- sweep periódico que pega as mudanças feitas
//     pelo site (que não consegue mexer no Discord sozinho)
//
// Regra de ouro (igual a services/supabaseSyncService.js): nada aqui pode derrubar quem
// chamou. Erros são só logados.
const { TAG_POR_RANK, TAG_NEUTRA, montarNick, nomeLimpo, normalizarLetras } = require('../utils/ranks');

// Nome de exibição do jogador a partir da linha da aba Jogadores: coluna `nome` (limpa)
// ou, se ainda não migrada, tira a tag do `discord_nick` cru.
function nomeDaLinha(row) {
  return normalizarLetras((row.get('nome') || '').trim()) || nomeLimpo(row.get('discord_nick')) || 'Jogador';
}

/**
 * Reescreve o apelido de um membro pra "{tag do rank CONFIRMADO} ┃ {nome}" quando está
 * diferente do que deveria. Atualiza `nome`/`discord_nick` na linha (o CHAMADOR é responsável
 * por dar row.save()) -- nunca mexe em `rank_trupe`, que é decidido em outro lugar. Não lança.
 *
 * @param {import('discord.js').GuildMember} member
 * @param {import('google-spreadsheet').GoogleSpreadsheetRow} row
 * @returns {Promise<{ status: string, de?: string, para?: string, motivo?: string }>}
 */
async function reconciliarNick(member, row) {
  try {
    if (!member) return { status: 'ausente' }; // saiu do servidor

    const nome = nomeDaLinha(row);
    const rankTrupe = (row.get('rank_trupe') || '').trim();

    // rank_trupe vazio = ainda não rankeado pela administração — fica com a tag neutra até
    // um /rankear. Não mexe (nem no nick, nem no rank_trupe).
    const tag = rankTrupe ? (TAG_POR_RANK[rankTrupe] || TAG_NEUTRA) : TAG_NEUTRA;
    const nickDesejado = montarNick(nome, tag);

    row.set('nome', nome);
    row.set('discord_nick', nickDesejado);

    if (member.displayName === nickDesejado) return { status: 'ja_ok' };

    if (!member.manageable) {
      // Dono do servidor (o Discord nunca deixa renomear) ou cargo acima do bot.
      return { status: 'sem_permissao', de: member.displayName, para: nickDesejado };
    }

    const de = member.displayName;
    await member.setNickname(nickDesejado, 'Sincroniza apelido com o rank confirmado');
    return { status: 'renomeado', de, para: nickDesejado };
  } catch (err) {
    console.error(`[rank-nick] Falha ao reconciliar apelido de ${member?.id}:`, err.message);
    return { status: 'erro', motivo: err.message };
  }
}

module.exports = { reconciliarNick, nomeDaLinha };
