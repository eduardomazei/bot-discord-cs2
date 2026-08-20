const axios = require('axios');
const csv = require('csv-parser');
const { Readable } = require('stream');

/**
 * Função auxiliar para tentar realizar o download de um caminho específico do Pterodactyl
 */
async function tentarDownloadArquivo(pteroUrl, serverId, apiKey, filePath) {
  try {
    const baseUrl = pteroUrl.replace(/\/+$/, '');
    const fileParam = filePath.startsWith('/') ? filePath : `/${filePath}`;

    const url = `${baseUrl}/api/client/servers/${serverId}/files/contents?file=${encodeURIComponent(fileParam)}`;

    const response = await axios.get(url, {
      headers: {
        'Authorization': `Bearer ${apiKey.trim()}`,
        'Accept': 'application/json, text/plain, */*',
        'Content-Type': 'application/json'
      }
    });

    if (response.data) {
      return response.data;
    }
    return null;
  } catch (err) {
    return null;
  }
}

/**
 * Baixa o CSV da partida via API do Pterodactyl
 */
async function baixarCSVPartida(matchId, serverId) {
  const pteroUrl = process.env.PTERODACTYL_URL;
  const apiKey = process.env.PTERODACTYL_API_KEY;

  if (!apiKey) {
    throw new Error('PTERODACTYL_API_KEY não está configurada no arquivo .env');
  }

  const possiveisCaminhos = [
    `/game/csgo/MatchZy_Stats/${matchId}/match_data_map0_${matchId}.csv`,
    `game/csgo/MatchZy_Stats/${matchId}/match_data_map0_${matchId}.csv`,
    `/csgo/MatchZy_Stats/${matchId}/match_data_map0_${matchId}.csv`,
    `csgo/MatchZy_Stats/${matchId}/match_data_map0_${matchId}.csv`,
    `/MatchZy_Stats/${matchId}/match_data_map0_${matchId}.csv`,
    `MatchZy_Stats/${matchId}/match_data_map0_${matchId}.csv`,
    `/game/csgo/MatchZy_Stats/match_data_map0_${matchId}.csv`,
    `/csgo/MatchZy_Stats/match_data_map0_${matchId}.csv`
  ];

  console.log(`🔍 Buscando CSV da partida #${matchId} no servidor ${serverId}...`);

  let rawCsvData = null;
  let caminhoEncontrado = null;

  for (const filePath of possiveisCaminhos) {
    rawCsvData = await tentarDownloadArquivo(pteroUrl, serverId, apiKey, filePath);
    if (rawCsvData) {
      caminhoEncontrado = filePath;
      break;
    }
  }

  if (!rawCsvData) {
    throw new Error(`Partida ou arquivo CSV não encontrado no servidor (${serverId}).`);
  }

  console.log(`🎯 CSV encontrado: ${caminhoEncontrado}`);

  try {
    const results = [];
    const stream = Readable.from(rawCsvData);

    return new Promise((resolve, reject) => {
      stream.pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', () => resolve(results))
        .on('error', (err) => reject(err));
    });
  } catch (error) {
    throw new Error(`Erro ao ler os dados do arquivo CSV (${matchId}).`);
  }
}

/**
 * Checa se essa partida (mesmo matchid NO MESMO servidor) já foi importada antes.
 * matchid sozinho não é chave única — cada um dos 3-4 servidores tem sua própria
 * numeração de partida do MatchZy, então o mesmo matchid pode existir legitimamente
 * em servidores diferentes. A chave de deduplicação é sempre (server_id, matchid).
 */
async function verificarPartidaJaImportada(doc, matchId, serverId) {
  await doc.loadInfo();
  const sheetPartidas = doc.sheetsByTitle['Partidas'];
  await sheetPartidas.loadHeaderRow();
  const rows = await sheetPartidas.getRows();
  return rows.some(r => r.get('matchid') === matchId && r.get('server_id') === serverId);
}

/**
 * Lê o CSV da partida e calcula tudo (elencos, vencedor, MVP, stats, variação de Elo) SEM
 * gravar nada no Google Sheets ainda. O chamador mostra esse resultado pro admin conferir
 * (nomes reais de cada time batem com o placar que ele digitou?) e só grava de fato chamando
 * gravarPartida(...) depois de uma confirmação explícita — ver docs/adr/0002-importar-partida-preview-antes-de-gravar.md
 */
async function calcularPartida(matchId, serverId, mapa, doc, scoreA = 13, scoreB = 0, timeVencedorInput = null, mixId = '', rodada = '', corTimeA = '', corTimeB = '') {
  await doc.loadInfo();
  const sheetJogadores = doc.sheetsByTitle['Jogadores'];
  await sheetJogadores.loadHeaderRow();

  // 1. Busca os dados reais do CSV no Pterodactyl
  const matchData = await baixarCSVPartida(matchId, serverId);

  if (!matchData || matchData.length === 0) {
    throw new Error('O arquivo CSV da partida está vazio.');
  }

  // 2. Mapeia steamid64 -> Dados do Jogador cadastrado na planilha
  const rowsJogadores = await sheetJogadores.getRows();
  const mapaJogadores = new Map();

  rowsJogadores.forEach(row => {
    const rawSteamId = row.get('steamid64');
    if (rawSteamId) {
      const steamIdStr = String(rawSteamId).trim();
      mapaJogadores.set(steamIdStr, {
        row,
        discordId: row.get('discord_id') || 'N/A',
        discordNick: row.get('discord_nick') || 'N/A',
        eloAtual: parseInt(row.get('elo') || 1000),
        matchsAtual: parseInt(row.get('matchs') || 0),
        winsAtual: parseInt(row.get('wins') || 0),
        killsAtual: parseInt(row.get('kills') || 0),
        deathsAtual: parseInt(row.get('deaths') || 0),
        assistsAtual: parseInt(row.get('assists') || 0),
        hsAtual: parseInt(row.get('head_shot_kills') || 0),
        damageAtual: parseInt(row.get('damage') || 0)
      });
    }
  });

  // 3. Organização de Times e Decisão do Vencedor
  // Identifica o nome dos dois times no CSV (ex: team1/team2 ou nomes customizados)
  const nomesTimes = [...new Set(matchData.map(p => p.teamname || p.team || 'Time A'))];
  const nomeTimeA = nomesTimes[0] || 'Time A';
  const nomeTimeB = nomesTimes[1] || 'Time B';

  let teamWinner = timeVencedorInput;
  if (!teamWinner) {
    if (parseInt(scoreA) > parseInt(scoreB)) {
      teamWinner = nomeTimeA;
    } else if (parseInt(scoreB) > parseInt(scoreA)) {
      teamWinner = nomeTimeB;
    } else {
      teamWinner = nomeTimeA; // Empate padrão
    }
  }
  // Rótulo normalizado gravado na planilha (bate com "Time A"/"Time B" usados no elenco),
  // em vez do nome de time cru do CSV (que pode ser "CT"/"TERRORIST"/tag de clã/etc).
  // Ver docs/adr/0001-elenco-partida-resolvido-em-tempo-de-leitura.md
  const teamWinnerLabel = teamWinner === nomeTimeA ? 'Time A' : 'Time B';
  // Nome de cor do vencedor pro preview do /importar-partida -- ver docs/adr/0005. Cai pro
  // rótulo genérico se as cores não vieram (ex: chamada antiga sem esses parâmetros).
  const teamWinnerCor = teamWinnerLabel === 'Time A' ? (corTimeA || teamWinnerLabel) : (corTimeB || teamWinnerLabel);

  const idsTimeA = [];
  const idsTimeB = [];
  // Só os nomes (sem steamid64), pra mostrar no preview de confirmação do /importar-partida.
  const nomesTimeA = [];
  const nomesTimeB = [];
  let mvpNick = 'N/A';
  let maxKillsMVP = -1;
  let maxDamageMVP = -1;

  // Linhas de Stats_Partidas e atualizações pendentes em Jogadores — só viram gravação de
  // verdade dentro de gravarPartida(), depois da confirmação do admin.
  const statsRows = [];
  const jogadorUpdates = [];

  // 4. Processa linha por linha do CSV
  for (const player of matchData) {
    const steamId = String(player.steamid64 || player.steamid || '').trim();
    const jogadorBase = mapaJogadores.get(steamId);

    const teamNamePlayer = player.teamname || player.team || nomeTimeA;
    const isTimeA = teamNamePlayer === nomeTimeA;
    const eVitoria = teamNamePlayer === teamWinner;

    // Stats Básicos
    const kills = parseInt(player.kills || 0);
    const deaths = parseInt(player.deaths || 0);
    const assists = parseInt(player.assists || 0);
    const damage = parseInt(player.damage || 0);
    const hs = parseInt(player.head_shot_kills || 0);
    const entryCount = parseInt(player.entry_count || 0);
    const entryWins = parseInt(player.entry_wins || 0);

    // Descobre quem foi o MVP da partida (Mais Kills / Dano)
    if (kills > maxKillsMVP || (kills === maxKillsMVP && damage > maxDamageMVP)) {
      maxKillsMVP = kills;
      maxDamageMVP = damage;
      mvpNick = jogadorBase ? `<@${jogadorBase.discordId}>` : (player.name || player.player_name || steamId);
    }

    // Separa cada participante do time como "steamid64:nomeCS2" (registrado ou não).
    // A resolução pra menção Discord acontece na leitura (/partida-info, /x1), não aqui —
    // ver docs/adr/0001-elenco-partida-resolvido-em-tempo-de-leitura.md
    if (steamId) {
      const nomeCsvJogador = String(player.name || player.player_name || steamId)
        .replace(/,/g, ' ')  // vírgula é o separador entre jogadores na célula
        .trim() || steamId;
      const parJogador = `${steamId}:${nomeCsvJogador}`;
      if (isTimeA) {
        idsTimeA.push(parJogador);
        nomesTimeA.push(nomeCsvJogador);
      } else {
        idsTimeB.push(parJogador);
        nomesTimeB.push(nomeCsvJogador);
      }
    }

    // Stats Utilitárias
    const utilityCount = parseInt(player.utility_count || 0);
    const utilityDamage = parseInt(player.utility_damage || player.utiliity_damage || 0);
    const utilitySuccesses = parseInt(player.utility_successes || 0);
    const flashCount = parseInt(player.flash_count || 0);
    const flashSuccesses = parseInt(player.flash_successes || 0);
    const enemiesFlashed = parseInt(player.enemies_flashed || 0);

    // Multikills
    const enemy2ks = parseInt(player.enemy2ks || 0);
    const enemy3ks = parseInt(player.enemy3ks || 0);
    const enemy4ks = parseInt(player.enemy4ks || 0);
    const enemy5ks = parseInt(player.enemy5ks || 0);

    // Clutches
    const v1Count = parseInt(player.v1_count || 0);
    const v1Wins = parseInt(player.v1_wins || 0);
    const v2Count = parseInt(player.v2_count || 0);
    const v2Wins = parseInt(player.v2_wins || 0);

    // Cálculo de ADR e Elo
    const totalRounds = (parseInt(scoreA) + parseInt(scoreB)) || 24;
    const adr = damage / totalRounds;
    let bonusAdr = 0;
    if (adr > 100) bonusAdr = 5;
    else if (adr < 50) bonusAdr = -3;

    const variacaoElo = eVitoria ? (25 + bonusAdr) : (-20 + bonusAdr);

    // O apóstrofo (') força o Sheets a exibir o sinal de '+' como Texto
    const strDiff = variacaoElo >= 0 ? `'+${variacaoElo}` : `'${variacaoElo}`;

    // A) Linha pendente pra "Stats_Partidas" (gravada em gravarPartida)
    statsRows.push({
      'matchid': matchId,
      'map': mapa,
      'server_id': serverId,
      'teamname': teamNamePlayer,
      'steamid64': steamId,
      'discord_id': jogadorBase ? jogadorBase.discordId : 'NÃO_REGISTRADO',
      'nick_discord': jogadorBase ? jogadorBase.discordNick : (player.name || 'N/A'),
      'kills': kills.toString(),
      'head_shot_kills': hs.toString(),
      'deaths': deaths.toString(),
      'assists': assists.toString(),
      'damage': damage.toString(),
      'utility_count': utilityCount.toString(),
      'utility_damage': utilityDamage.toString(),
      'utility_successes': utilitySuccesses.toString(),
      'flash_count': flashCount.toString(),
      'flash_successes': flashSuccesses.toString(),
      'enemies_flashed': enemiesFlashed.toString(),
      'entry_count': entryCount.toString(),
      'entry_wins': entryWins.toString(),
      'enemy2ks': enemy2ks.toString(),
      'enemy3ks': enemy3ks.toString(),
      'enemy4ks': enemy4ks.toString(),
      'enemy5ks': enemy5ks.toString(),
      'v1_count': v1Count.toString(),
      'v1_wins': v1Wins.toString(),
      'v2_count': v2Count.toString(),
      'v2_wins': v2Wins.toString(),
      'elo_diff': strDiff
    });

    // B) Atualização pendente pro acumulado em "Jogadores" (aplicada em gravarPartida)
    if (jogadorBase) {
      const {
        row, eloAtual, matchsAtual, winsAtual,
        killsAtual, deathsAtual, assistsAtual, hsAtual, damageAtual
      } = jogadorBase;

      jogadorUpdates.push({
        row,
        novoElo: Math.max(0, eloAtual + variacaoElo),
        novoMatchs: matchsAtual + 1,
        incrementaVitoria: eVitoria,
        novoWins: winsAtual + (eVitoria ? 1 : 0),
        novoKills: killsAtual + kills,
        novoDeaths: deathsAtual + deaths,
        novoAssists: assistsAtual + assists,
        novoHs: hsAtual + hs,
        novoDamage: damageAtual + damage
      });
    }
  }

  // 5. Link direto para os arquivos da partida no Pterodactyl
  const baseUrl = process.env.PTERODACTYL_URL.replace(/\/+$/, '');
  const directFileLink = `${baseUrl}/server/${serverId}/files#/game/csgo/MatchZy_Stats/${matchId}`;

  return {
    matchId,
    serverId,
    mapa,
    scoreA,
    scoreB,
    teamWinnerLabel,
    teamWinnerCor,
    mixId,
    rodada,
    corTimeA,
    corTimeB,
    nomeTimeA,
    nomeTimeB,
    nomesTimeA,
    nomesTimeB,
    idsTimeA,
    idsTimeB,
    mvpNick,
    directFileLink,
    statsRows,
    jogadorUpdates
  };
}

/**
 * Grava de fato o resultado de calcularPartida(...) nas 3 abas — só deve ser chamada depois
 * que o admin confirmou o preview (evita sujar Elo/stats de jogadores cadastrados com um
 * import errado que ninguém confirmou de olhos abertos).
 */
async function gravarPartida(pending, doc) {
  const sheetPartidas = doc.sheetsByTitle['Partidas'];
  const sheetStats = doc.sheetsByTitle['Stats_Partidas'];
  await sheetPartidas.loadHeaderRow();
  await sheetStats.loadHeaderRow();

  // A) Stats_Partidas — uma linha por jogador
  for (const statsRow of pending.statsRows) {
    await sheetStats.addRow(statsRow);
  }

  // B) Jogadores — acumulado de quem está cadastrado
  for (const upd of pending.jogadorUpdates) {
    upd.row.set('elo', upd.novoElo.toString());
    upd.row.set('matchs', upd.novoMatchs.toString());
    if (upd.incrementaVitoria) upd.row.set('wins', upd.novoWins.toString());
    upd.row.set('kills', upd.novoKills.toString());
    upd.row.set('deaths', upd.novoDeaths.toString());
    upd.row.set('assists', upd.novoAssists.toString());
    upd.row.set('head_shot_kills', upd.novoHs.toString());
    upd.row.set('damage', upd.novoDamage.toString());
    await upd.row.save();
  }

  // C) Partidas — resumo da partida
  await sheetPartidas.addRow({
    'matchid': pending.matchId,
    'date': new Date().toLocaleString('pt-BR'),
    'map': pending.mapa,
    'server_id': pending.serverId,
    'team_winner': pending.teamWinnerLabel,
    'score_a': pending.scoreA.toString(),
    'score_b': pending.scoreB.toString(),
    'team_a_ids': pending.idsTimeA.join(', '),
    'team_b_ids': pending.idsTimeB.join(', '),
    'mvp': pending.mvpNick,
    'link_demo_and_stats': pending.directFileLink,
    // Ver docs/adr/0005-times-com-nome-de-cor-e-mix-id.md -- colunas precisam existir
    // manualmente na aba Partidas antes de rodar isso (mesmo padrão da aba Streamers).
    'mix_id': pending.mixId,
    'rodada': pending.rodada,
    'team_a_cor': pending.corTimeA,
    'team_b_cor': pending.corTimeB
  });

  console.log(`✅ Partida #${pending.matchId} (servidor ${pending.serverId}) totalmente integrada no Google Sheets!`);
}

module.exports = { verificarPartidaJaImportada, calcularPartida, gravarPartida };
