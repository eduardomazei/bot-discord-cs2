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
 * Processa a partida lendo o CSV e atualiza as 3 abas no Google Sheets
 */
async function processarPartidaFiregames(matchId, serverId, mapa, doc, scoreA = 13, scoreB = 0, timeVencedorInput = null) {
  try {
    await doc.loadInfo();
    const sheetJogadores = doc.sheetsByTitle['Jogadores'];
    const sheetPartidas = doc.sheetsByTitle['Partidas'];
    const sheetStats = doc.sheetsByTitle['Stats_Partidas'];

    await sheetJogadores.loadHeaderRow();
    await sheetPartidas.loadHeaderRow();
    await sheetStats.loadHeaderRow();

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

    const idsTimeA = [];
    const idsTimeB = [];
    let mvpNick = 'N/A';
    let maxKillsMVP = -1;
    let maxDamageMVP = -1;

    // 4. Processa linha por linha do CSV e atualiza as abas
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

      // Separa IDs de cada time
      if (jogadorBase) {
        if (isTimeA) idsTimeA.push(`<@${jogadorBase.discordId}>`);
        else idsTimeB.push(`<@${jogadorBase.discordId}>`);
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

      // A) Grava na aba "Stats_Partidas"
      await sheetStats.addRow({
        'matchid': matchId,
        'map': mapa,
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

      // B) Atualiza acumulado na aba "Jogadores"
      if (jogadorBase) {
        const {
          row, eloAtual, matchsAtual, winsAtual,
          killsAtual, deathsAtual, assistsAtual, hsAtual, damageAtual
        } = jogadorBase;

        const novoElo = Math.max(0, eloAtual + variacaoElo);
        row.set('elo', novoElo.toString());
        row.set('matchs', (matchsAtual + 1).toString());
        if (eVitoria) row.set('wins', (winsAtual + 1).toString());
        row.set('kills', (killsAtual + kills).toString());
        row.set('deaths', (deathsAtual + deaths).toString());
        row.set('assists', (assistsAtual + assists).toString());
        row.set('head_shot_kills', (hsAtual + hs).toString());
        row.set('damage', (damageAtual + damage).toString());

        await row.save();
      }
    }

    // 5. Link direto para os arquivos da partida no Pterodactyl
    const baseUrl = process.env.PTERODACTYL_URL.replace(/\/+$/, '');
    const directFileLink = `${baseUrl}/server/${serverId}/files#/game/csgo/MatchZy_Stats/${matchId}`;

    // 6. Grava resumo na aba "Partidas"
    await sheetPartidas.addRow({
      'matchid': matchId,
      'date': new Date().toLocaleString('pt-BR'),
      'map': mapa,
      'team_winner': teamWinner,
      'score_a': scoreA.toString(),
      'score_b': scoreB.toString(),
      'team_a_ids': idsTimeA.join(', '),
      'team_b_ids': idsTimeB.join(', '),
      'mvp': mvpNick,
      'link_demo_and_stats': directFileLink
    });

    console.log(`✅ Partida #${matchId} totalmente integrada no Google Sheets!`);
    return true;

  } catch (error) {
    console.error('❌ Erro no firegamesService:', error);
    throw error;
  }
}

module.exports = { processarPartidaFiregames };