// Mantém a tag de rank no apelido do Discord em sincronia com o Elo. A administração dá o
// rank inicial via /rankear; a partir daí o rank é derivado do Elo (obterRank) e este
// serviço reescreve o apelido sempre que uma partida importada faz o Elo do jogador
// cruzar uma fronteira de rank.
//
// Regra de ouro (igual a services/supabaseSyncService.js): nada aqui pode derrubar o
// comando que chamou. É chamado DEPOIS de gravarPartida() já ter gravado tudo no Sheets;
// qualquer erro é só logado.
const { obterRank, tagDoElo, montarNick, nomeLimpo, normalizarLetras } = require('../utils/ranks');
const { sincronizarRankNick } = require('./supabaseSyncService');

// Pausa entre renames pra não bater no rate limit de edição de membro do Discord numa
// sequência de mix com várias mudanças de rank de uma vez.
const PAUSA_ENTRE_RENAMES_MS = 800;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// Nome de exibição do jogador a partir da linha da aba Jogadores: coluna `nome` (limpa)
// ou, se ainda não migrada, tira a tag do `discord_nick` cru.
function nomeDaLinha(row) {
  return normalizarLetras((row.get('nome') || '').trim()) || nomeLimpo(row.get('discord_nick')) || 'Jogador';
}

/**
 * Reescreve o apelido de um membro pra "{tag do Elo} ┃ {nome}" quando está diferente do
 * que deveria. Atualiza a linha da aba Jogadores (nome/rank_trupe/discord_nick) — o CHAMADOR
 * é responsável por dar row.save(). Não lança.
 *
 * @param {import('discord.js').GuildMember} member
 * @param {import('google-spreadsheet').GoogleSpreadsheetRow} row
 * @returns {Promise<{ status: string, de?: string, para?: string, motivo?: string }>}
 */
async function reconciliarNick(member, row) {
  try {
    if (!member) return { status: 'ausente' }; // saiu do servidor

    const nome = nomeDaLinha(row);
    const elo = parseInt(row.get('elo') || 1000, 10);
    const rankTrupe = (row.get('rank_trupe') || '').trim();

    // rank_trupe vazio = ainda não rankeado pela administração — fica com a tag neutra, o
    // Elo não promove sozinho até um /rankear. Não mexe.
    if (!rankTrupe) return { status: 'nao_rankeado' };

    const rankAtualLetra = obterRank(elo).nome;
    const nickDesejado = montarNick(nome, tagDoElo(elo, rankTrupe));

    // Espelha na planilha mesmo quando o nick já está certo (mantém rank_trupe/nome/nick
    // coerentes com o Elo pra próxima comparação barata).
    row.set('nome', nome);
    row.set('rank_trupe', rankAtualLetra);
    row.set('discord_nick', nickDesejado);

    if (member.displayName === nickDesejado) return { status: 'ja_ok' };

    if (!member.manageable) {
      // Dono do servidor (o Discord nunca deixa renomear) ou cargo acima do bot.
      return { status: 'sem_permissao', de: member.displayName, para: nickDesejado };
    }

    const de = member.displayName;
    await member.setNickname(nickDesejado, 'Sincroniza tag de rank com o Elo');
    return { status: 'renomeado', de, para: nickDesejado };
  } catch (err) {
    console.error(`[rank-nick] Falha ao reconciliar apelido de ${member?.id}:`, err.message);
    return { status: 'erro', motivo: err.message };
  }
}

/**
 * Após um /importar-partida gravado: pra cada jogador cadastrado cujo Elo cruzou uma
 * fronteira de rank nessa partida, reescreve o apelido no Discord + planilha. Nunca lança.
 *
 * @param {import('discord.js').Guild} guild
 * @param {Array<{ row: any, discordId: string, eloAntigo: number, novoElo: number }>} jogadorUpdates
 * @returns {Promise<Array<{ discordId: string, de: string, para: string, subiu: boolean }>>}
 *          lista só das mudanças efetivamente aplicadas (pra montar o resumo no reply).
 */
async function aplicarRenamesPosPartida(guild, jogadorUpdates) {
  const aplicados = [];
  if (!guild || !Array.isArray(jogadorUpdates)) return aplicados;

  // Só quem realmente mudou de letra de rank nessa partida — evita fetch de membro +
  // save de linha pra todo mundo do mix a cada import.
  const cruzaram = jogadorUpdates.filter((u) => {
    const antes = obterRank(Number(u.eloAntigo) || 1000).nome;
    const depois = obterRank(Number(u.novoElo) || 1000).nome;
    return antes !== depois;
  });

  for (const upd of cruzaram) {
    try {
      const member = await guild.members.fetch(upd.discordId).catch(() => null);
      const res = await reconciliarNick(member, upd.row);

      if (res.status === 'renomeado' || res.status === 'ja_ok' || res.status === 'sem_permissao') {
        try {
          await upd.row.save();
        } catch (err) {
          console.error(`[rank-nick] Falha ao salvar linha de ${upd.discordId}:`, err.message);
        }
        // Dual-write pro Supabase (best-effort).
        await sincronizarRankNick({
          discordId: upd.discordId,
          nome: upd.row.get('nome'),
          rankTrupe: upd.row.get('rank_trupe'),
          discordNick: upd.row.get('discord_nick'),
        });
      }

      if (res.status === 'renomeado') {
        const subiu = (Number(upd.novoElo) || 0) > (Number(upd.eloAntigo) || 0);
        aplicados.push({ discordId: upd.discordId, de: res.de, para: res.para, subiu });
      } else if (res.status === 'sem_permissao') {
        console.warn(`[rank-nick] ${upd.discordId} mudou de rank mas o bot não pode renomear (dono/hierarquia).`);
      }
    } catch (err) {
      console.error(`[rank-nick] Erro inesperado no rename de ${upd.discordId}:`, err.message);
    }
    await dormir(PAUSA_ENTRE_RENAMES_MS);
  }

  return aplicados;
}

module.exports = { reconciliarNick, aplicarRenamesPosPartida, nomeDaLinha };
