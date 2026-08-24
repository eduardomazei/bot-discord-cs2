// Helpers de leitura da aba "Partidas" reusados por comandos de stats que precisam do total de
// rounds de uma partida específica -- pra calcular ADR de verdade em vez de assumir um número
// fixo de rounds (bug que existia duplicado em hall-da-fama.js e stats-mapa.js: `damage / 24`
// ignorava o placar real, então uma partida 13-2 [15 rounds] tinha ADR calculado errado).

// matchid sozinho não é único entre servidores -- mesma regra de dedupe do
// verificarPartidaJaImportada() em firegamesService.js.
function encontrarPartida(rowsPartidas, matchid, serverId) {
  return rowsPartidas.find(r => r.get('matchid') === matchid && r.get('server_id') === serverId);
}

// Total de rounds jogados numa partida (score_a + score_b). Cai pro padrão de 24 (MR12 sem OT)
// quando a partida correspondente não é encontrada -- ex: linha de Stats_Partidas órfã, ou dado
// legado sem os placares gravados.
function totalRoundsDaPartida(rowPartida) {
  if (!rowPartida) return 24;
  const a = parseInt(rowPartida.get('score_a') || 0);
  const b = parseInt(rowPartida.get('score_b') || 0);
  return (a + b) || 24;
}

module.exports = { encontrarPartida, totalRoundsDaPartida };
