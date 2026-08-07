const { SlashCommandBuilder } = require('discord.js');
const { desativarStreamer } = require('../utils/streamers');
const { ehAdministrador, replyNoPermission } = require('../utils/permissions');
const { buildContainer, componentsV2Payload, MessageFlags } = require('../utils/containers');

const COR_AVISO = 0xe74c3c;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('removerstreamer')
    .setDescription('Remove o status de streamer oficial de um jogador (apenas ADM)')
    .addUserOption((option) =>
      option.setName('jogador').setDescription('Jogador que deixará de ser streamer').setRequired(true)
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

      const streamer = await desativarStreamer(jogadorUser.id);

      if (!streamer) {
        // A mensagem foi criada com IsComponentsV2 (ver deferReply acima), então não dá pra
        // editar com `content` puro — precisa continuar em container.
        const containerNaoAtivo = buildContainer({
          cor: COR_AVISO,
          titulo: '<a:trupe_aviso:1535106703870271489> Streamer não encontrado',
          corpo: `<@${jogadorUser.id}> não está registrado como streamer ativo.`,
        });
        await interaction.editReply(componentsV2Payload(containerNaoAtivo));
        return;
      }

      const container = buildContainer({
        cor: COR_AVISO,
        titulo: '<:trupe_bloqueado:1535106635477811242> Streamer removido',
        corpo: `<@${jogadorUser.id}> não é mais um streamer oficial do Mix Trupe CS2.`,
        rodape: 'Mix Trupe CS2 • Streamers',
      });

      await interaction.editReply(componentsV2Payload(container));
    } catch (error) {
      console.error('Erro no /removerstreamer:', error);
      try {
        const container = buildContainer({
          cor: 0xe74c3c,
          titulo: '<a:trupe_erro:1535106712359407626> Erro',
          corpo: 'Ocorreu um erro ao remover o streamer. Tente novamente.',
        });
        const payload = componentsV2Payload(container, { ephemeral: true });
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply(payload);
        } else {
          await interaction.reply(payload);
        }
      } catch (fallbackError) {
        console.error('Falha ao enviar mensagem de erro do /removerstreamer:', fallbackError);
      }
    }
  },
};
