const { SlashCommandBuilder } = require('discord.js');
const { getSheet } = require('../../utils/sheets');
const { buildContainer, componentsV2Payload, MessageFlags } = require('../../utils/containers');
const { CORES } = require('../../utils/colors');

module.exports = {
  // exigeRegistro fica no default (true) -- 'stats-mapa' não estava em
  // comandosLiberados no legado, então já exigia cadastro antes desta migração.

  data: new SlashCommandBuilder()
    .setName('stats-mapa')
    .setDescription('Exibe estatísticas da comunidade ou de um jogador filtradas por mapa')
    .addStringOption(option =>
      option.setName('mapa')
        .setDescription('Selecione o mapa')
        .setRequired(false)
        .addChoices(
          { name: 'Dust2', value: 'De_dust2' },
          { name: 'Mirage', value: 'De_mirage' },
          { name: 'Inferno', value: 'De_inferno' },
          { name: 'Nuke', value: 'De_nuke' },
          { name: 'Ancient', value: 'De_ancient' },
          { name: 'Anubis', value: 'De_anubis' },
          { name: 'Cache', value: 'De_cache' }
        )
    )
    .addUserOption(option =>
      option.setName('jogador')
        .setDescription('Ver estatísticas de um jogador específico no mapa')
        .setRequired(false)
    ),

  async execute(interaction) {
    // A flag IsComponentsV2 precisa ser declarada já aqui -- não dá pra adicionar depois via editReply.
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

    try {
      const mapaFiltro = interaction.options.getString('mapa');
      const jogadorFiltro = interaction.options.getUser('jogador');

      const sheetStats = await getSheet('Stats_Partidas');
      const sheetPartidas = await getSheet('Partidas');

      const rowsStats = await sheetStats.getRows();
      const rowsPartidas = await sheetPartidas.getRows();

      if (!mapaFiltro && !jogadorFiltro) {
        const mapaContagem = {};
        rowsPartidas.forEach(row => {
          const m = row.get('map') || 'Desconhecido';
          mapaContagem[m] = (mapaContagem[m] || 0) + 1;
        });

        const mapasOrdenados = Object.entries(mapaContagem)
          .sort((a, b) => b[1] - a[1])
          .map(([m, qtd], index) => `**${index + 1}. ${m}** — ${qtd} partida(s)`)
          .join('\n') || 'Nenhuma partida registrada.';

        return await interaction.editReply(componentsV2Payload(
          buildContainer({
            cor: CORES.SUCESSO,
            titulo: '<:trupe_teia:1536412408203976888> Estatísticas de Mapas da Comunidade',
            corpo: `🔥 **Mapas Mais Jogados**\n${mapasOrdenados}`,
            rodape: 'Use /stats-mapa [mapa] para ver o Rei do Mapa!',
          })
        ));
      }

      if (mapaFiltro && !jogadorFiltro) {
        const partidasDoMapa = rowsPartidas.filter(r => (r.get('map') || '').toLowerCase() === mapaFiltro.toLowerCase());
        const statsDoMapa = rowsStats.filter(r => (r.get('map') || '').toLowerCase() === mapaFiltro.toLowerCase());

        if (partidasDoMapa.length === 0) {
          return await interaction.editReply(componentsV2Payload(
            buildContainer({ cor: CORES.AVISO, titulo: 'Sem dados', corpo: `<:trupe_aviso:1536410370829328434> Nenhuma partida registrada no mapa **${mapaFiltro}** ainda.` })
          ));
        }

        const playerMapStats = {};
        statsDoMapa.forEach(row => {
          const discordId = row.get('discord_id');
          const nick = row.get('nick_discord') || 'Jogador';
          const kills = parseInt(row.get('kills') || 0);
          const deaths = parseInt(row.get('deaths') || 0);

          if (!playerMapStats[discordId]) {
            playerMapStats[discordId] = { nick, kills: 0, deaths: 0, jogos: 0 };
          }

          playerMapStats[discordId].kills += kills;
          playerMapStats[discordId].deaths += deaths;
          playerMapStats[discordId].jogos += 1;
        });

        let reiDoMapa = null;
        let melhorKD = -1;

        Object.values(playerMapStats).forEach(p => {
          const kd = p.deaths === 0 ? p.kills : (p.kills / p.deaths);
          if (kd > melhorKD) {
            melhorKD = kd;
            reiDoMapa = p;
          }
        });

        const corpoMapa = [
          `🎮 **Total de Partidas**: ${partidasDoMapa.length}`,
          '',
          '👑 **Rei do Mapa**',
          reiDoMapa ? `**${reiDoMapa.nick}**\nK/D: \`${melhorKD.toFixed(2)}\` (${reiDoMapa.kills}K / ${reiDoMapa.deaths}D em ${reiDoMapa.jogos} partida/s)` : 'Sem dados',
        ].join('\n');

        return await interaction.editReply(componentsV2Payload(
          buildContainer({ cor: CORES.AVISO, titulo: `<:trupe_teia:1536412408203976888> Estatísticas do Mapa: ${mapaFiltro}`, corpo: corpoMapa })
        ));
      }

      if (mapaFiltro && jogadorFiltro) {
        const statsJogador = rowsStats.filter(r =>
          r.get('discord_id') === jogadorFiltro.id &&
          (r.get('map') || '').toLowerCase() === mapaFiltro.toLowerCase()
        );

        if (statsJogador.length === 0) {
          return await interaction.editReply(componentsV2Payload(
            buildContainer({ cor: CORES.AVISO, titulo: 'Sem dados', corpo: `<:trupe_aviso:1536410370829328434> O jogador <@${jogadorFiltro.id}> não possui dados gravados no mapa **${mapaFiltro}**.` })
          ));
        }

        let totalKills = 0, totalDeaths = 0, totalAssists = 0, totalDano = 0;
        statsJogador.forEach(r => {
          totalKills += parseInt(r.get('kills') || 0);
          totalDeaths += parseInt(r.get('deaths') || 0);
          totalAssists += parseInt(r.get('assists') || 0);
          totalDano += parseFloat(r.get('damage') || 0);
        });

        const partidasQtd = statsJogador.length;
        const kdRatio = totalDeaths === 0 ? totalKills : (totalKills / totalDeaths).toFixed(2);
        const adrMedio = (totalDano / (partidasQtd * 24)).toFixed(1);

        const corpoJogador = [
          `**Partidas**: ${partidasQtd}`,
          `**K / D / A**: ${totalKills} / ${totalDeaths} / ${totalAssists}`,
          `**K/D Ratio**: ${kdRatio}`,
          `**ADR Médio**: ${adrMedio}`,
        ].join('\n');

        return await interaction.editReply(componentsV2Payload(
          buildContainer({ cor: CORES.INFO, titulo: `<:trupe_teia:1536412408203976888> ${jogadorFiltro.username} no mapa ${mapaFiltro}`, corpo: corpoJogador })
        ));
      }
    } catch (error) {
      console.error('Erro no /stats-mapa:', error);
      await interaction.editReply(componentsV2Payload(
        buildContainer({ cor: CORES.AVISO, titulo: 'Erro', corpo: '<:trupe_aviso:1536410370829328434> Erro ao consultar as estatísticas por mapa.' })
      ));
    }
  },
};
