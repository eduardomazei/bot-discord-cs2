const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { ehAdministrador } = require('../../utils/permissions');

module.exports = {
  // exigeRegistro fica no default (true) -- 'mover-times' não estava em
  // comandosLiberados no legado, então já exigia cadastro antes desta migração.

  data: new SlashCommandBuilder()
    .setName('mover-times')
    .setDescription('[Owner/Directors] Move automaticamente os dois times para as salas de voz especificadas')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(opt =>
      opt.setName('canal_time_a')
        .setDescription('Canal de voz do Time A (CT)')
        .setRequired(true)
    )
    .addChannelOption(opt =>
      opt.setName('canal_time_b')
        .setDescription('Canal de voz do Time B (TR)')
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!(await ehAdministrador(interaction))) {
      return await interaction.reply({
        content: '<:trupe_erro:1536410911617843322> Apenas membros com o cargo **Owner** ou **Directors** podem mover membros!',
        ephemeral: true
      });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const canalA = interaction.options.getChannel('canal_time_a');
      const canalB = interaction.options.getChannel('canal_time_b');

      if (!interaction.member.voice.channel) {
        return await interaction.editReply('<:trupe_erro:1536410911617843322> Você precisa estar em um canal de voz para mover os jogadores.');
      }

      const membrosNaVoz = Array.from(interaction.member.voice.channel.members.values());

      let movidosA = 0;
      let movidosB = 0;

      for (let i = 0; i < membrosNaVoz.length; i++) {
        if (i % 2 === 0) {
          await membrosNaVoz[i].voice.setChannel(canalA);
          movidosA++;
        } else {
          await membrosNaVoz[i].voice.setChannel(canalB);
          movidosB++;
        }
      }

      return await interaction.editReply(`<:trupe_sucesso:1536412279778574356> **Jogadores movidos!**\n• **${canalA.name}:** ${movidosA} jogadores\n• **${canalB.name}:** ${movidosB} jogadores`);
    } catch (err) {
      console.error('Erro no /mover-times:', err);
      return await interaction.editReply('<:trupe_erro:1536410911617843322> Erro ao mover membros. Verifique se o Bot tem a permissão "Mover Membros".');
    }
  },
};
