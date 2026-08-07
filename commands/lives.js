const { SlashCommandBuilder } = require('discord.js');
const { getStreamerAtivo } = require('../utils/streamers');
const { CANAIS } = require('../utils/config');
const { buildContainer, componentsV2Payload } = require('../utils/containers');

const COR_LIVE = 0x9146ff;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('lives')
    .setDescription('Avisa que você entrou ao vivo na Twitch'),

  async execute(interaction) {
    try {
      // Confirma a interação já de cara: a checagem na planilha (getStreamerAtivo)
      // e o envio no canal de lives podem levar mais de 3s, e o token expira nesse prazo.
      await interaction.deferReply({ ephemeral: true });

      const streamer = await getStreamerAtivo(interaction.user.id);

      if (!streamer) {
        await interaction.editReply({
          content: '<a:trupe_aviso:1535106703870271489> Você não está registrado como streamer oficial. Peça a um ADM para usar `/addstreamer`.',
        });
        return;
      }

      if (!CANAIS.lives) {
        await interaction.editReply({
          content: '<a:trupe_aviso:1535106703870271489> O canal de lives ainda não foi configurado. Peça a um ADM para configurar em `/config`.',
        });
        return;
      }

      const canal = interaction.guild.channels.cache.get(CANAIS.lives);

      if (!canal || !canal.isTextBased()) {
        await interaction.editReply({
          content: '<a:trupe_aviso:1535106703870271489> O canal de lives configurado não foi encontrado. Peça a um ADM para reconfigurar em `/config`.',
        });
        return;
      }

      const container = buildContainer({
        cor: COR_LIVE,
        titulo: '<:trupe_live:1535106655681912955> AO VIVO AGORA!',
        corpo: `**<@${interaction.user.id}>** está ao vivo na Twitch! Vem ver! <:trupe_game:1535106649277202562>\n\n<:trupe_twitch:1535106681124556942> **Canal:** ${streamer.get('Canal Twitch')}`,
        thumbnailUrl: interaction.user.displayAvatarURL(),
        rodape: 'Mix Trupe CS2 • Lives',
      });

      await canal.send(componentsV2Payload(container));

      await interaction.editReply({
        content: `<a:trupe_sucesso:1535106719305175122> Aviso de live enviado em <#${canal.id}>!`,
      });
    } catch (error) {
      console.error('Erro no /lives:', error);
      try {
        const payload = {
          content: '<a:trupe_erro:1535106712359407626> Ocorreu um erro ao enviar o aviso de live. Tente novamente.',
          ephemeral: true,
        };
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply(payload);
        } else {
          await interaction.reply(payload);
        }
      } catch (fallbackError) {
        // Interação já pode estar expirada/inválida (ex: token vencido) — só loga, nunca derruba o processo.
        console.error('Falha ao enviar mensagem de erro do /lives:', fallbackError);
      }
    }
  },
};
