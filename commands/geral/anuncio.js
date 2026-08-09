const { SlashCommandBuilder, ChannelType } = require('discord.js');
const { ehAdministrador, replyNoPermission } = require('../../utils/permissions');
const { buildContainer, componentsV2Payload } = require('../../utils/containers');

const COR_PADRAO = 0xff6600;
const HEX_REGEX = /^#?[0-9a-fA-F]{6}$/;

module.exports = {
  // Não exige cadastro prévio (/registrar) -- reproduz o bypass que hoje vem do
  // despacho antecipado dos comandos modulares em index.js. Ver docs/plans/modularizacao-index-js.md, seção 4.1.
  exigeRegistro: false,

  data: new SlashCommandBuilder()
    .setName('anuncio')
    .setDescription('Cria um anúncio personalizado (apenas ADM)')
    .addStringOption((option) =>
      option.setName('titulo').setDescription('Título do anúncio').setRequired(true)
    )
    .addStringOption((option) =>
      option
        .setName('descricao')
        .setDescription('Texto do anúncio.')
        .setRequired(true)
    )
    .addChannelOption((option) =>
      option
        .setName('canal')
        .setDescription('Canal de destino do anúncio')
        .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setRequired(true)
    )
    .addStringOption((option) =>
      option.setName('cor').setDescription('Cor em hex, ex: #FF6600 (opcional)').setRequired(false)
    )
    .addAttachmentOption((option) =>
      option.setName('imagem').setDescription('Imagem para anexar ao anúncio (opcional)').setRequired(false)
    ),

  async execute(interaction) {
    try {
      if (!(await ehAdministrador(interaction))) {
        await replyNoPermission(interaction);
        return;
      }

      const titulo = interaction.options.getString('titulo');
      const descricao = interaction.options.getString('descricao');
      const canal = interaction.options.getChannel('canal');
      const corRaw = (interaction.options.getString('cor') || '').trim();
      const imagem = interaction.options.getAttachment('imagem');

      if (!canal.isTextBased()) {
        await interaction.reply({
          content: '<:trupe_erro:1535757225631686686> O canal escolhido precisa ser um canal de texto.',
          ephemeral: true,
        });
        return;
      }

      let cor = COR_PADRAO;
      if (corRaw) {
        if (!HEX_REGEX.test(corRaw)) {
          await interaction.reply({
            content: '<:trupe_erro:1535757225631686686> Cor em hex inválida. Use o formato `#RRGGBB` (ex: `#FF6600`).',
            ephemeral: true,
          });
          return;
        }
        cor = parseInt(corRaw.replace('#', ''), 16);
      }

      if (imagem && !imagem.contentType?.startsWith('image/')) {
        await interaction.reply({
          content: '<:trupe_erro:1535757225631686686> O anexo enviado não é uma imagem válida.',
          ephemeral: true,
        });
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      const container = buildContainer({
        cor,
        titulo,
        corpo: descricao,
        imagemUrl: imagem?.url,
        rodape: 'Mix Trupe CS2 • Anúncio',
      });

      await canal.send(componentsV2Payload(container));

      await interaction.editReply({
        content: `<:trupe_sucesso:1535757248930775041> Anúncio enviado com sucesso em <#${canal.id}>.`,
      });
    } catch (error) {
      console.error('Erro no /anuncio:', error);
      try {
        const payload = {
          content: '<:trupe_erro:1535757225631686686> Ocorreu um erro ao enviar o anúncio. Verifique se o bot tem permissão para postar no canal escolhido.',
          ephemeral: true,
        };
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply(payload);
        } else {
          await interaction.reply(payload);
        }
      } catch (fallbackError) {
        console.error('Falha ao enviar mensagem de erro do /anuncio:', fallbackError);
      }
    }
  },
};
