const axios = require('axios');
const csv = require('csv-parser');
const { Readable } = require('stream');

/**
 * Baixa o CSV da partida via API do Pterodactyl
 */
async function baixarCSVPartida(matchId, serverId) {
  const pteroUrl = process.env.PTERODACTYL_URL;
  const apiKey = process.env.PTERODACTYL_API_KEY;
  const filePath = `/csgo/MatchZy_Stats/${matchId}/match_data_map0_${matchId}.csv`;

  try {
    const response = await axios.get(`${pteroUrl}/api/client/servers/${serverId}/files/contents`, {
      params: { file: filePath },
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Accept': 'application/json'
      }
    });

    const results = [];
    const stream = Readable.from(response.data);

    return new Promise((resolve, reject) => {
      stream.pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', () => resolve(results))
        .on('error', (err) => reject(err));
    });
  } catch (error) {
    console.error(`❌ Erro ao buscar CSV da partida ${matchId} no servidor ${serverId}:`, error.message);
    throw new Error(`Partida ou arquivo CSV não encontrado no servidor (${serverId}).`);
  }
}

/**
 * Processa a partida lendo o CSV e atualiza as 3 abas no Google Sheets
 */
async function processarPartidaFiregames(matchId, serverId, mapa, doc) {
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
      const steamId = row.get('steamid64')?.trim();
      if (steamId) {
        mapaJogadores.set(steamId, {
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

    // 3. Organização de Times e Placa
    const primeiroTime = matchData[0].teamname;
    const timeA = matchData.filter(p => p.teamname === primeiroTime);
    const timeB = matchData.filter(p => p.teamname !== primeiroTime);

    // Kills brutas por time para decidir o time_winner
    const killsTimeA = timeA.reduce((acc, p) => acc + (parseInt(p.kills) || 0), 0);
    const killsTimeB = timeB.reduce((acc, p) => acc + (parseInt(p.kills) || 0), 0);
    const teamWinner = killsTimeA >= killsTimeB ? primeiroTime : (timeB[0]?.teamname || 'Time B');

    const idsTimeA = [];
    const idsTimeB = [];

    // 4. Processa linha por linha do CSV e atualiza as abas
    for (const player of matchData) {
      const steamId = player.steamid64;
      const jogadorBase = mapaJogadores.get(steamId);

      const isTimeA = player.teamname === primeiroTime;
      const eVitoria = player.teamname === teamWinner;

      const kills = parseInt(player.kills || 0);
      const deaths = parseInt(player.deaths || 0);
      const assists = parseInt(player.assists || 0);
      const damage = parseInt(player.damage || 0);
      const hs = parseInt(player.head_shot_kills || 0);
      const utilDamage = parseInt(player.utility_damage || 0);
      const entryCount = parseInt(player.entry_count || 0);
      const entryWins = parseInt(player.entry_wins || 0);

      if (jogadorBase) {
        if (isTimeA) idsTimeA.push(jogadorBase.discordId);
        else idsTimeB.push(jogadorBase.discordId);
      }

      // Cálculo de ADR e Elo
      const adr = damage / 24; // Estimativa média de rounds
      let bonusAdr = 0;
      if (adr > 100) bonusAdr = 5;
      else if (adr < 50) bonusAdr = -3;

      const variacaoElo = eVitoria ? (25 + bonusAdr) : (-20 + bonusAdr);
      const strDiff = variacaoElo >= 0 ? `+${variacaoElo}` : `${variacaoElo}`;

      // A) Grava na aba "Stats_Partidas"
      await sheetStats.addRow({
        'matchid': matchId,
        'map': mapa,
        'teamname': player.teamname,
        'steamid64': steamId,
        'discord_id': jogadorBase ? jogadorBase.discordId : 'NÃO_REGISTRADO',
        'nick_discord': jogadorBase ? jogadorBase.discordNick : 'N/A',
        'kills': kills.toString(),
        'head_shot_kills': hs.toString(),
        'deaths': deaths.toString(),
        'assists': assists.toString(),
        'damage': damage.toString(),
        'utility_damage': utilDamage.toString(),
        'entry_count': entryCount.toString(),
        'entry_wins': entryWins.toString(),
        'elo_diff': strDiff
      });

      // B) Atualiza o acumulado na aba "Jogadores"
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

    // 5. Grava o resumo na aba "Partidas"
    await sheetPartidas.addRow({
      'matchid': matchId,
      'date': new Date().toLocaleString('pt-BR'),
      'map': mapa,
      'team_winner': teamWinner,
      'score_a': '13',
      'score_b': '11',
      'team_a_ids': idsTimeA.join(', '),
      'team_b_ids': idsTimeB.join(', '),
      'mvp': 'N/A',
      'link_demo_and_stats': `${process.env.PTERODACTYL_URL}/server/${serverId}`
    });

    console.log(`✅ Partida #${matchId} integrada com sucesso via Pterodactyl!`);
    return true;

  } catch (error) {
    console.error('❌ Erro no firegamesService:', error);
    throw error;
  }
}

module.exports = { processarPartidaFiregames };