// Extraído de legacy/interactionRouter.js na migração de /x1 (comando 10/21) -- compartilhado com
// /partida-info (ainda não migrado). Ver docs/adr/0001-elenco-partida-resolvido-em-tempo-de-leitura.md
const { obterJogadorPorSteamId } = require('../services/registroService');

// --- LEITURA DO ELENCO DE UMA PARTIDA (team_a_ids / team_b_ids da aba Partidas) ---
// Formato novo (a partir de docs/adr/0001): "steamid64:nomeCS2,steamid64:nomeCS2,...".
// Formato antigo (partidas gravadas antes dessa mudança): "<@discordId>, <@discordId>, ...".
// A célula é interpretada token a token, sem assumir que todas as partidas de uma mesma
// planilha estão no mesmo formato.
function interpretarCelulaElenco(cell) {
  return (cell || '')
    .split(',')
    .map(pedaco => pedaco.trim())
    .filter(Boolean)
    .map(pedaco => {
      if (pedaco.startsWith('<@')) {
        return { formato: 'antigo', discordId: pedaco.replace(/[<@>]/g, ''), steamId: null, nomeCsv: null };
      }
      const idx = pedaco.indexOf(':');
      if (idx > -1) {
        return { formato: 'novo', steamId: pedaco.slice(0, idx).trim(), nomeCsv: pedaco.slice(idx + 1).trim(), discordId: null };
      }
      // Célula em formato inesperado (ex: editada manualmente na planilha) — trata como texto puro.
      return { formato: 'desconhecido', discordId: null, steamId: null, nomeCsv: pedaco };
    });
}

// Resolve as entradas de um elenco (ver interpretarCelulaElenco) pra exibição: menção Discord se
// a pessoa estiver cadastrada agora, nome cru do CS2 caso contrário. Reavaliado a cada chamada —
// por isso um jogador que se registra depois passa a aparecer corretamente em partidas antigas.
async function resolverElencoParaExibicao(entradas) {
  const linhas = [];
  for (const entrada of entradas) {
    if (entrada.formato === 'antigo') {
      linhas.push(`<@${entrada.discordId}>`);
    } else if (entrada.formato === 'novo') {
      const jogador = await obterJogadorPorSteamId(entrada.steamId);
      // ❔ em vez de "(não cadastrado)" por extenso — o /partida-info explica o ícone no rodapé.
      linhas.push(jogador ? `<@${jogador.discordId}>` : `${entrada.nomeCsv} ❔`);
    } else {
      linhas.push(entrada.nomeCsv || 'N/I');
    }
  }
  return linhas;
}

// Verifica se um discord_id específico jogou num time (usado pelo /x1). Precisa checar tanto
// entradas no formato antigo (discordId direto) quanto no formato novo (steamId — resolvido via
// o steamid64 do próprio jogador, buscado no cache de registro antes de chamar esta função).
function timeContemJogador(entradas, discordId, steamIdDoJogador) {
  return entradas.some(entrada =>
    (entrada.formato === 'antigo' && entrada.discordId === discordId) ||
    (entrada.formato === 'novo' && steamIdDoJogador && entrada.steamId === steamIdDoJogador)
  );
}

module.exports = { interpretarCelulaElenco, resolverElencoParaExibicao, timeContemJogador };
