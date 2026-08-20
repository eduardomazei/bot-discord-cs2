const { SlashCommandBuilder } = require('discord.js');
const { getSheet } = require('../../utils/sheets');
const { buildContainer, componentsV2Payload, MessageFlags } = require('../../utils/containers');
const { CORES } = require('../../utils/colors');

module.exports = {
  // exigeRegistro fica no default (true) -- 'elo' não estava em comandosLiberados
  // no legado, então já exigia cadastro antes desta migração.

  data: new SlashCommandBuilder()
    .setName('elo')
    .setDescription('Exibe a pontuação de Elo e histórico de performance de um jogador')
    .addUserOption(opt =>
      opt.setName('usuario')
        .setDescription('Jogador para consultar o Elo')
        .setRequired(false)
    ),

  async execute(interaction) {
    // A flag IsComponentsV2 precisa ser declarada já aqui -- não dá pra adicionar depois via editReply.
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

    const targetUser = interaction.options.getUser('usuario') || interaction.user;
    const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    const displayName = targetMember ? targetMember.displayName : targetUser.username;

    try {
      const sheet = await getSheet('Jogadores');
      const rows = await sheet.getRows();

      const pRow = rows.find(r => r.get('discord_id') === targetUser.id);

      if (!pRow) {
        return await interaction.editReply(componentsV2Payload(
          buildContainer({
            cor: CORES.ERRO,
            titulo: 'Jogador não cadastrado',
            corpo: `<:trupe_erro:1536410911617843322> O jogador **${displayName}** ainda não possui cadastro via \`/registrar\`.`,
          })
        ));
      }

      const elo = pRow.get('elo') || '1000';
      const partidas = parseInt(pRow.get('matchs') || 0);
      const vitorias = parseInt(pRow.get('wins') || 0);

      const corpo = [
        `<:trupe_elo_up:1536410866709176492> **Elo / MMR Atual**: ${elo} pts`,
        `<:trupe_partidas_mazei:1536591014809178172> **Partidas Jogadas**: ${partidas}`,
        `<a:trupe_trofeu:1536412945339129857> **Vitórias**: ${vitorias}`,
      ].join('\n');

      return await interaction.editReply(componentsV2Payload(
        buildContainer({
          cor: CORES.INFO,
          titulo: `<:trupe_teia:1536412408203976888> Pontuação de Elo — ${displayName}`,
          corpo,
          thumbnailUrl: targetUser.displayAvatarURL({ dynamic: true }),
          rodape: 'Elo varia pelo seu KD na partida: Vitória +10~40 | Derrota -5~30 · Use /rank pra ver sua evolução',
        })
      ));
    } catch (err) {
      console.error('Erro no /elo:', err);
      return await interaction.editReply(componentsV2Payload(
        buildContainer({ cor: CORES.AVISO, titulo: 'Erro', corpo: '<:trupe_aviso:1536410370829328434> Erro ao consultar pontuação de Elo.' })
      ));
    }
  },
};
