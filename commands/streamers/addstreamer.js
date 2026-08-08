const { SlashCommandBuilder } = require('discord.js');
const { upsertStreamer } = require('../../utils/streamers');
const { ehAdministrador, replyNoPermission } = require('../../utils/permissions');
const { buildContainer, componentsV2Payload, MessageFlags } = require('../../utils/containers');

const COR_STREAMER = 0x9146ff;

module.exports = {
  // Não exige cadastro prévio (/registrar) -- reproduz o bypass que hoje vem do
  // despacho antecipado dos comandos modulares em index.js. Ver docs/plans/modularizacao-index-js.md, seção 4.1.
  exigeRegistro: false,

  data: new SlashCommandBuilder()
    .setName('addstreamer')
    .setDescription('Registra um streamer oficial do Mix Trupe (apenas ADM)')
    .addUserOption((option) =>
      option.setName('jogador').setDescription('Jogador que será registrado como streamer').setRequired(true)
    )
    .addStringOption((option) =>
      option.setName('canal_twitch').setDescription('URL ou nome do canal na Twitch').setRequired(true)
    ),

  async execute(interaction) {
    try {
      if (!(await ehAdministrador(interaction))) {
        await replyNoPermission(interaction);
        return;
      }

      // Confirma a interação antes da escrita na planilha (pode levar mais de 3s).
      // A flag IsComponentsV2 precisa ser declarada já aqui: não dá pra adicionar depois via editReply.
      await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

      const jogadorUser = interaction.options.getUser('jogador');
      const canalTwitch = interaction.options.getString('canal_twitch').trim();

      const streamer = await upsertStreamer(jogadorUser.id, canalTwitch);

      const container = buildContainer({
        cor: COR_STREAMER,
        titulo: '<:trupe_streamer:1535106674099224706> Streamer registrado',
        corpo: `<@${jogadorUser.id}> agora é um streamer oficial do Mix Trupe CS2!\n\n<:trupe_twitch:1535106681124556942> **Canal Twitch:** ${streamer.get('Canal Twitch')}`,
        rodape: 'Mix Trupe CS2 • Streamers',
      });

      await interaction.editReply(componentsV2Payload(container));
    } catch (error) {
      console.error('Erro no /addstreamer:', error);
      try {
        const container = buildContainer({
          cor: 0xe74c3c,
          titulo: '<a:trupe_erro:1535106712359407626> Erro',
          corpo: 'Ocorreu um erro ao registrar o streamer. Tente novamente.',
        });
        const payload = componentsV2Payload(container, { ephemeral: true });
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply(payload);
        } else {
          await interaction.reply(payload);
        }
      } catch (fallbackError) {
        console.error('Falha ao enviar mensagem de erro do /addstreamer:', fallbackError);
      }
    }
  },
};
