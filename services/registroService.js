// Extraído de legacy/interactionRouter.js na migração de /x1 (comando 10/21) --
// esse cache é usado por praticamente todo comando (a trava de registro que roda antes de quase
// toda interação, ver events/interactionCreate.js), então precisa continuar sendo um singleton
// de módulo em vez de ser duplicado em cada arquivo que precisa dele.
const { getSheet } = require('../utils/sheets');

// Cache dos SteamIDs por discord_id, usado pela trava de segurança (roda em praticamente todo
// comando, antes de qualquer resposta à interação). Sem esse cache, cada interação dispara sua
// própria consulta ao Google Sheets — sob uma rajada de uso simultâneo (ex: vários jogadores
// confirmando /presenca ao mesmo tempo), essas consultas concorrentes podem ultrapassar os 3s que
// o Discord dá pra reconhecer a interação, derrubando-a com "Unknown interaction".
const REGISTRO_CACHE_TTL_MS = 30 * 1000;
// steamIdsPorDiscordId: discord_id -> steamid64 (trava de registro, ver comentário acima).
// jogadorPorSteamId: steamid64 -> { discordId, discordNick } (sentido inverso, usado pra resolver
// elenco de Partidas — ver docs/adr/0001-elenco-partida-resolvido-em-tempo-de-leitura.md).
// As duas vêm da mesma leitura da aba Jogadores, então compartilham TTL/carregamento.
let registroCache = { steamIdsPorDiscordId: null, jogadorPorSteamId: null, timestamp: 0, carregando: null };

async function carregarRegistroCache() {
  try {
    const sheet = await getSheet('Jogadores');
    const rows = await sheet.getRows();
    const mapa = new Map();
    const porSteamId = new Map();
    for (const row of rows) {
      const discordId = row.get('discord_id');
      const steamId = row.get('steamid64');
      mapa.set(discordId, steamId);
      if (steamId && steamId !== 'N/A') {
        porSteamId.set(String(steamId).trim(), {
          discordId,
          discordNick: row.get('discord_nick') || 'N/A'
        });
      }
    }
    registroCache.steamIdsPorDiscordId = mapa;
    registroCache.jogadorPorSteamId = porSteamId;
    registroCache.timestamp = Date.now();
    return mapa;
  } finally {
    registroCache.carregando = null;
  }
}

// Chame depois de gravar um novo cadastro (/registrar), pra não deixar a pessoa "não registrada"
// aos olhos do bot por até REGISTRO_CACHE_TTL_MS depois de se cadastrar.
function invalidarRegistroCache() {
  registroCache.timestamp = 0;
}

// Garante que registroCache está com dados válidos (carrega ou reaproveita um carregamento já
// em andamento). Extraído de jogadorEstaRegistrado pra ser reaproveitado por quem também precisa
// do mapa reverso (jogadorPorSteamId), sem duplicar a lógica de TTL/coalescing.
async function garantirRegistroCacheCarregado() {
  const cacheValido = registroCache.steamIdsPorDiscordId && (Date.now() - registroCache.timestamp) < REGISTRO_CACHE_TTL_MS;
  if (cacheValido) return;

  if (registroCache.carregando) {
    // Já tem uma atualização em andamento (outra interação concorrente disparou) — reaproveita.
    await registroCache.carregando;
    return;
  }

  registroCache.carregando = carregarRegistroCache();
  await registroCache.carregando;
}

async function jogadorEstaRegistrado(discordId) {
  try {
    await garantirRegistroCacheCarregado();
    const steamId = registroCache.steamIdsPorDiscordId.get(discordId);
    return !!(steamId && steamId !== 'N/A');
  } catch (err) {
    console.error('Erro ao verificar registro do jogador:', err);
    return false;
  }
}

// Busca um jogador cadastrado pelo steamid64 (mapa reverso do cache de registro).
async function obterJogadorPorSteamId(steamId) {
  if (!steamId) return null;
  try {
    await garantirRegistroCacheCarregado();
    return registroCache.jogadorPorSteamId.get(String(steamId).trim()) || null;
  } catch (err) {
    console.error('Erro ao resolver jogador por steamId:', err);
    return null;
  }
}

// Busca o steamid64 cadastrado de um discord_id (sentido direto do cache). Usado pelo /x1 pra
// descobrir o steamid64 de quem está sendo comparado, sem expor o Map interno do cache.
async function obterSteamIdPorDiscordId(discordId) {
  await garantirRegistroCacheCarregado();
  return registroCache.steamIdsPorDiscordId.get(discordId);
}

module.exports = {
  jogadorEstaRegistrado,
  invalidarRegistroCache,
  obterJogadorPorSteamId,
  obterSteamIdPorDiscordId,
};
