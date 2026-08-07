const {
  ContainerBuilder,
  TextDisplayBuilder,
  SectionBuilder,
  ThumbnailBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
} = require('discord.js');

/**
 * Cria um Container (Components V2) com título, corpo e rodapé opcional,
 * padronizando o layout usado nos comandos migrados do trupe-bot.
 * @param {object} opts
 * @param {number} opts.cor - Cor de destaque (accent color) do container.
 * @param {string} opts.titulo - Texto do título (pode incluir emoji customizado).
 * @param {string} [opts.corpo] - Texto principal, pode ter múltiplas linhas.
 * @param {string} [opts.rodape] - Texto pequeno exibido no final (formatado como -# automaticamente).
 * @param {string} [opts.thumbnailUrl] - Se definido, o título+corpo viram uma Section com essa imagem ao lado.
 * @param {string} [opts.imagemUrl] - Se definido, adiciona uma imagem grande no corpo do container.
 * @param {import('discord.js').ActionRowBuilder[]} [opts.actionRows] - Linhas de botões/selects.
 * @returns {ContainerBuilder}
 */
function buildContainer({ cor, titulo, corpo, rodape, thumbnailUrl, imagemUrl, actionRows = [] }) {
  const container = new ContainerBuilder().setAccentColor(cor);

  const textoTitulo = `**${titulo}**`;

  if (thumbnailUrl) {
    const section = new SectionBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(textoTitulo))
      .setThumbnailAccessory(new ThumbnailBuilder().setURL(thumbnailUrl));

    if (corpo) {
      section.addTextDisplayComponents(new TextDisplayBuilder().setContent(corpo));
    }

    container.addSectionComponents(section);
  } else {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(textoTitulo));

    if (corpo) {
      container.addTextDisplayComponents(new TextDisplayBuilder().setContent(corpo));
    }
  }

  if (imagemUrl) {
    container.addMediaGalleryComponents(
      new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(imagemUrl))
    );
  }

  for (const row of actionRows) {
    container.addActionRowComponents(row);
  }

  if (rodape) {
    container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${rodape}`));
  }

  return container;
}

/**
 * Monta o payload pronto para reply/editReply/followUp/update com a flag
 * IsComponentsV2 já aplicada. Por padrão permite menções de usuário e cargo
 * (necessário porque TextDisplay não faz ping automático sem isso).
 * @param {ContainerBuilder|ContainerBuilder[]} containers
 * @param {object} [extra] - Campos extras (ex: ephemeral).
 */
function componentsV2Payload(containers, extra = {}) {
  const lista = Array.isArray(containers) ? containers : [containers];
  return {
    components: lista,
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: ['users', 'roles'] },
    ...extra,
  };
}

module.exports = { buildContainer, componentsV2Payload, MessageFlags };
