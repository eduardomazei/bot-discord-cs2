// Rótulo amigável pro server_id (hex opaco) — mesmos 4 servidores fixos do .env usados como
// choices em /partida-info (commands/stats/partida-info.js) e no placeholder do modal de /importar-partida.
// Extraído de legacy/interactionRouter.js na migração de /player (compartilhado com /partida-info).
const ROTULO_POR_SERVER_ID = {
  [process.env.SERVER_ID_1]: 'Servidor 1',
  [process.env.SERVER_ID_2]: 'Servidor 2',
  [process.env.SERVER_ID_3]: 'Servidor 3',
  [process.env.SERVER_ID_4]: 'Servidor 4',
};

function rotuloServidor(serverId) {
  if (!serverId) return 'N/I';
  return ROTULO_POR_SERVER_ID[serverId] || serverId;
}

module.exports = { rotuloServidor, ROTULO_POR_SERVER_ID };
