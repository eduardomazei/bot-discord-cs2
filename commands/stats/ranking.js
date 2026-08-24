const { SlashCommandBuilder } = require('discord.js');
const { getSheet } = require('../../utils/sheets');
const { buildContainer, componentsV2Payload, MessageFlags } = require('../../utils/containers');
const { CORES } = require('../../utils/colors');
const { obterRank } = require('../../utils/ranks');

module.exports = {
  // exigeRegistro fica no default (true) -- 'ranking' não estava em comandosLiberados
  // no legado, então já exigia cadastro antes desta migração.

  data: new SlashCommandBuilder()
    .setName('ranking')
    .setDescription('Exibe o Leaderboard com o Top 10 jogadores do Mix Trupe'),

  async execute(interaction) {
    // A flag IsComponentsV2 precisa ser declarada já aqui -- não dá pra adicionar depois via editReply.
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

    try {
      const sheet = await getSheet('Jogadores');
      const rows = await sheet.getRows();

      if (rows.length === 0) {
        return interaction.editReply(componentsV2Payload(
          buildContainer({ cor: CORES.INFO, titulo: 'Ranking', corpo: '📋 Nenhum jogador cadastrado na planilha ainda.' })
        ));
      }

      // discord_id sempre existe aqui (Jogadores só tem gente que passou por /registrar) --
      // diferente de Stats_Partidas, não tem caso de "não cadastrado" pra tratar.
      const rankedPlayers = rows.map(r => ({
        discordId: r.get('discord_id'),
        nick: r.get('discord_nick') || 'Jogador Desconhecido',
        vitorias: parseInt(r.get('wins') || 0),
        partidas: parseInt(r.get('matchs') || 0),
        elo: parseInt(r.get('elo') || 1000),
        kills: parseInt(r.get('kills') || 0),
        deaths: parseInt(r.get('deaths') || 0),
      })).sort((a, b) => b.elo - a.elo || b.vitorias - a.vitorias);

      const top10 = rankedPlayers.slice(0, 10);

      const medals = ['<:trupe_medalha_ouro:1536414206440771696>', '<:trupe_medalha_prata:1536414172357730344>', '<:trupe_medalha_bronze:1536414150006415381>'];
      let leaderboardText = '';

      top10.forEach((p, index) => {
        const medal = medals[index] || `\`#${index + 1}\``;
        const quemE = p.discordId ? `<@${p.discordId}>` : `**${p.nick}**`;
        const tier = obterRank(p.elo).emoji;
        leaderboardText += `${medal} ${quemE} — ${tier} **${p.elo} Elo** *(${p.vitorias}V | ${p.partidas}P)*\n`;
      });

      await interaction.editReply(componentsV2Payload(
        buildContainer({
          cor: CORES.AVISO,
          titulo: '<:trupe_teia:1536412408203976888> Top 10 Leaderboard (Elo) — Mix Trupe',
          corpo: leaderboardText || 'Nenhum dado para exibir.',
          rodape: 'Ordenado por Pontuação de Elo • Use /rank pra ver sua escada completa',
        })
      ));

    } catch (error) {
      console.error('Erro no /ranking:', error);
      await interaction.editReply(componentsV2Payload(
        buildContainer({ cor: CORES.AVISO, titulo: 'Erro', corpo: '<:trupe_aviso:1536410370829328434> Erro ao gerar o ranking do servidor.' })
      ));
    }
  },
};
