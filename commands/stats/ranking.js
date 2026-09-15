// Deixou de montar o Top 10 com dado da planilha em 15/09/2026 (decisão de centralizar tudo no
// site, ver CLAUDE.md/memória do trupe-site) -- ranking completo (não só Top 10) já mora
// em /ranking no site.
const { SlashCommandBuilder } = require('discord.js');
const { linkReplyPayload } = require('../../utils/linkReply');
const { linkRanking } = require('../../utils/siteLinks');

module.exports = {
  // exigeRegistro fica no default (true) -- 'ranking' não estava em comandosLiberados
  // no legado, então já exigia cadastro antes desta migração.

  data: new SlashCommandBuilder()
    .setName('ranking')
    .setDescription('Mostra o link do ranking (Elo) no site'),

  async execute(interaction) {
    return interaction.reply(linkReplyPayload({
      titulo: '<:trupe_teia:1536412408203976888> Ranking — Mix Trupe',
      corpo: 'Ranking completo por Elo, sempre atualizado, direto no site.',
      botoes: [{ label: 'Ver ranking no site', url: linkRanking() }],
    }));
  },
};
