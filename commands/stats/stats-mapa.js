const { SlashCommandBuilder } = require('discord.js');
const { getSheet } = require('../../utils/sheets');
const { buildContainer, componentsV2Payload, MessageFlags } = require('../../utils/containers');
const { CORES } = require('../../utils/colors');
const { encontrarPartida, totalRoundsDaPartida } = require('../../utils/partidas');

const MEDALHAS = ['<:trupe_medalha_ouro:1536414206440771696>', '<:trupe_medalha_prata:1536414172357730344>', '<:trupe_medalha_bronze:1536414150006415381>'];

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
          .map(([m, qtd], index) => `${MEDALHAS[index] || `\`#${index + 1}\``} **${m}** — ${qtd} partida(s)`)
          .join('\n') || 'Nenhuma partida registrada.';

        return await interaction.editReply(componentsV2Payload(
          buildContainer({
            cor: CORES.SUCESSO,
            titulo: '<:trupe_mapa_mazei:1536413320397979718> Estatísticas de Mapas da Comunidade',
            corpo: `<:trupe_stats_mazei:1536412231712112880> **Mapas Mais Jogados**\n${mapasOrdenados}`,
            rodape: 'Use /stats-mapa mapa:<mapa> pra ver o Rei do Mapa!',
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

        // Agrupado por steamid64 (sempre presente e único por jogador), não por discord_id --
        // jogadores não cadastrados compartilham o mesmo discord_id literal "NÃO_REGISTRADO" em
        // Stats_Partidas, então agrupar por ele misturava as estatísticas de pessoas diferentes.
        const playerMapStats = {};
        statsDoMapa.forEach(row => {
          const steamId = row.get('steamid64') || row.get('discord_id');
          const discordId = row.get('discord_id');
          const nick = row.get('nick_discord') || 'Jogador';

          if (!playerMapStats[steamId]) {
            playerMapStats[steamId] = { discordId, nick, kills: 0, deaths: 0, jogos: 0 };
          }

          playerMapStats[steamId].kills += parseInt(row.get('kills') || 0);
          playerMapStats[steamId].deaths += parseInt(row.get('deaths') || 0);
          playerMapStats[steamId].jogos += 1;
        });

        // Menção Discord quando o jogador está cadastrado (mesmo ícone ❔ usado no /partida-info
        // pra quem ainda não fez /registrar) -- ver docs/adr/0001.
        function mencao(p) {
          return p.discordId && p.discordId !== 'NÃO_REGISTRADO' ? `<@${p.discordId}>` : `${p.nick} ❔`;
        }

        const top3 = Object.values(playerMapStats)
          .sort((a, b) => {
            const kdA = a.deaths === 0 ? a.kills : a.kills / a.deaths;
            const kdB = b.deaths === 0 ? b.kills : b.kills / b.deaths;
            return kdB - kdA;
          })
          .slice(0, 3);

        const temNaoCadastrado = top3.some(p => !p.discordId || p.discordId === 'NÃO_REGISTRADO');

        const listaTop3 = top3.map((p, i) => {
          const kd = p.deaths === 0 ? p.kills : (p.kills / p.deaths);
          return `${MEDALHAS[i]} ${mencao(p)} — \`${kd.toFixed(2)}\` KD *(${p.kills}K / ${p.deaths}D em ${p.jogos} partida/s)*`;
        }).join('\n');

        const corpoMapa = [
          `<:trupe_partidas_mazei:1536591014809178172> **Total de Partidas**: ${partidasDoMapa.length}`,
          '',
          '<:trupe_coroa_mazei:1537477117686718574> **Rei do Mapa (Top 3 KD)**',
          listaTop3 || 'Sem dados',
        ].join('\n');

        return await interaction.editReply(componentsV2Payload(
          buildContainer({
            cor: CORES.AVISO,
            titulo: `<:trupe_mapa_mazei:1536413320397979718> Estatísticas do Mapa: ${mapaFiltro}`,
            corpo: corpoMapa,
            rodape: temNaoCadastrado ? 'Mix Trupe CS2 • ❔ = jogador ainda não fez /registrar' : 'Mix Trupe CS2 • Estatísticas de Mapa',
          })
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

        const targetMember = await interaction.guild.members.fetch(jogadorFiltro.id).catch(() => null);
        const displayName = targetMember ? targetMember.displayName : jogadorFiltro.username;

        let totalKills = 0, totalDeaths = 0, totalAssists = 0, totalDano = 0, totalHs = 0, totalRounds = 0;
        statsJogador.forEach(r => {
          totalKills += parseInt(r.get('kills') || 0);
          totalDeaths += parseInt(r.get('deaths') || 0);
          totalAssists += parseInt(r.get('assists') || 0);
          totalDano += parseFloat(r.get('damage') || 0);
          totalHs += parseInt(r.get('head_shot_kills') || 0);
          // Rounds reais da partida (não um fixo de 24) -- ver utils/partidas.js.
          const partida = encontrarPartida(rowsPartidas, r.get('matchid'), r.get('server_id'));
          totalRounds += totalRoundsDaPartida(partida);
        });

        const partidasQtd = statsJogador.length;
        const kdRatio = totalDeaths === 0 ? totalKills.toFixed(2) : (totalKills / totalDeaths).toFixed(2);
        const hsPct = totalKills > 0 ? Math.round((totalHs / totalKills) * 100) : 0;
        const adrMedio = (totalDano / totalRounds).toFixed(1);

        const corpoJogador = [
          `<:trupe_partidas_mazei:1536591014809178172> **Partidas**: ${partidasQtd}`,
          `<:trupe_kills_mazei:1536411018765402212> **Kills**: ${totalKills}`,
          `<:trupe_mortes_mazei:1536411384496267406> **Deaths**: ${totalDeaths}`,
          `<:trupe_assist_mazei:1536409760679600198> **Assists**: ${totalAssists}`,
          `<:trupe_kdr_mazei:1536410965111734313> **K/D Ratio**: ${kdRatio}`,
          `<:trupe_crosshair_mazei:1536410637117292705> **Headshots %**: ${hsPct}%`,
          `💥 **ADR Médio**: ${adrMedio}`,
        ].join('\n');

        return await interaction.editReply(componentsV2Payload(
          buildContainer({
            cor: CORES.INFO,
            titulo: `<:trupe_mapa_mazei:1536413320397979718> ${displayName} — ${mapaFiltro}`,
            corpo: corpoJogador,
            thumbnailUrl: jogadorFiltro.displayAvatarURL({ dynamic: true }),
            rodape: 'Mix Trupe CS2 • Estatísticas por Mapa',
          })
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
