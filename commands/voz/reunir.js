const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { ehAdministrador } = require('../../utils/permissions');

module.exports = {
  // exigeRegistro fica no default (true) -- 'reunir' não estava em
  // comandosLiberados no legado, então já exigia cadastro antes desta migração.

  data: new SlashCommandBuilder()
    .setName('reunir')
    .setDescription('[Owner/Directors] Move todos os jogadores dos canais de time de volta para o Lobby')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(opt =>
      opt.setName('canal_lobby')
        .setDescription('Canal de voz do Lobby principal')
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!(await ehAdministrador(interaction))) {
      return await interaction.reply({
        content: '<:trupe_erro:1536410911617843322> Apenas membros com o cargo **Owner** ou **Directors** podem usar este comando!',
        ephemeral: true
      });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const canalLobby = interaction.options.getChannel('canal_lobby');
      const guild = interaction.guild;

      let reunidos = 0;
      const voiceChannels = guild.channels.cache.filter(c => c.isVoiceBased());

      for (const [id, channel] of voiceChannels) {
        if (channel.id !== canalLobby.id) {
          for (const member of channel.members.values()) {
            await member.voice.setChannel(canalLobby);
            reunidos++;
          }
        }
      }

      return await interaction.editReply(`<:trupe_sucesso:1536412279778574356> **${reunidos} jogadores reunidos** no canal **${canalLobby.name}**!`);
    } catch (err) {
      console.error('Erro no /reunir:', err);
      return await interaction.editReply('<:trupe_erro:1536410911617843322> Erro ao reunir jogadores.');
    }
  },
};
