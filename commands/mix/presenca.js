// Deixou de gerenciar a lista de presença no Discord em 16/09/2026 (decisão de centralizar
// tudo no site, ver CLAUDE.md/memória do trupe-site). O site já tem tudo isso, melhor:
// criar/finalizar lista (ADM, via /admin/mix -- e já dispara o mesmo aviso no Discord que
// /presenca criar disparava, ver app/api/presenca/route.js no trupe-site) e confirmar/cancelar
// presença (jogador, via /presenca no site, com promoção automática da reserva por ordem --
// não precisa mais de um /presenca promover manual). O painel embed que se auto-atualizava
// (state/presencaStore.js, state/presencaPersistence.js) foi removido junto -- órfão sem esse
// comando.
const { SlashCommandBuilder } = require('discord.js');
const { linkReplyPayload } = require('../../utils/linkReply');
const { linkPresenca } = require('../../utils/siteLinks');

module.exports = {
  // exigeRegistro fica no default (true) -- 'presenca' não estava em
  // comandosLiberados no legado, então já exigia cadastro antes desta migração.

  data: new SlashCommandBuilder()
    .setName('presenca')
    .setDescription('Mostra o link da lista de presença no site'),

  async execute(interaction) {
    return interaction.reply(linkReplyPayload({
      titulo: '<:trupe_presenca:1536411530944446546> Presença — Mix Trupe',
      corpo: 'Confirma (ou cancela) sua presença direto no site -- reserva promove por ordem automaticamente quando abre vaga.',
      botoes: [{ label: 'Ver presença no site', url: linkPresenca() }],
    }));
  },
};
