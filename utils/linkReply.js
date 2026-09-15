// Payload compartilhado pelos comandos de stats que pararam de montar embed com dado da
// planilha/Supabase e passaram a só apontar pro site (ver utils/siteLinks.js e o comentário no
// topo de cada comando migrado). Botão(ões) estilo Link -- o Discord abre a URL direto, sem
// disparar interação nenhuma pro bot.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { buildContainer, componentsV2Payload } = require('./containers');
const { CORES } = require('./colors');

/**
 * @param {object} opts
 * @param {string} opts.titulo
 * @param {string} [opts.corpo]
 * @param {string} [opts.thumbnailUrl]
 * @param {string} [opts.rodape]
 * @param {{label: string, url: string}[]} opts.botoes - 1 a 5 botões Link.
 * @param {number} [opts.cor] - Accent color do container (padrão: CORES.INFO).
 * @param {boolean} [opts.ephemeral] - Resposta visível só pra quem clicou/rodou o comando.
 */
function linkReplyPayload({ titulo, corpo, thumbnailUrl, rodape, botoes, cor, ephemeral }) {
  const row = new ActionRowBuilder().addComponents(
    ...botoes.map(({ label, url }) => new ButtonBuilder().setLabel(label).setStyle(ButtonStyle.Link).setURL(url))
  );
  return componentsV2Payload(
    buildContainer({ cor: cor ?? CORES.INFO, titulo, corpo, thumbnailUrl, rodape, actionRows: [row] }),
    ephemeral ? { ephemeral: true } : {}
  );
}

module.exports = { linkReplyPayload };
