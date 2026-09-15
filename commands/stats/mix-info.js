// Deixou de montar rodadas/confrontos/placares com dado da planilha em 15/09/2026 (decisão de
// centralizar tudo no site, ver CLAUDE.md/memória do trupe-site) -- /mixes no site já mostra o
// bracket da mix atual e o histórico das concluídas. Sem link profundo por mix_id ainda (o site
// não tem essa rota), então aponta pra página geral.
const { SlashCommandBuilder } = require('discord.js');
const { linkReplyPayload } = require('../../utils/linkReply');
const { linkMixes } = require('../../utils/siteLinks');

module.exports = {
  // exigeRegistro fica no default (true) -- mesma trava dos outros comandos de stats.

  data: new SlashCommandBuilder()
    .setName('mix-info')
    .setDescription('Mostra o link da mix (bracket, confrontos e placares) no site'),

  async execute(interaction) {
    return interaction.reply(linkReplyPayload({
      titulo: '<:trupe_teia:1536412408203976888> Mix — Trupe',
      corpo: 'Bracket da mix atual e o histórico de mixes concluídas, direto no site.',
      botoes: [{ label: 'Ver mixes no site', url: linkMixes() }],
    }));
  },
};
