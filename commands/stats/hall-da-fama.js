// Deixou de calcular os recordes com dado da planilha em 15/09/2026 (decisão de centralizar
// tudo no site, ver CLAUDE.md/memória do trupe-site). O site ganhou uma página de recordes
// all-time dedicada em 16/09/2026 (/hall-da-fama: maior ADR/kills numa partida, veterano,
// winrate, kills de carreira, entry, clutch, mira) -- trocado o fallback (/season + /ranking)
// de ontem por ela.
const { SlashCommandBuilder } = require('discord.js');
const { linkReplyPayload } = require('../../utils/linkReply');
const { linkHallDaFama } = require('../../utils/siteLinks');

module.exports = {
  // exigeRegistro fica no default (true) -- 'hall-da-fama' não estava em
  // comandosLiberados no legado, então já exigia cadastro antes desta migração.

  data: new SlashCommandBuilder()
    .setName('hall-da-fama')
    .setDescription('Mostra o link dos recordes all-time no site'),

  async execute(interaction) {
    return interaction.reply(linkReplyPayload({
      titulo: '<:trupe_coroa_mazei:1537477117686718574> Hall da Fama — Mix Trupe',
      corpo: 'Maior ADR e kills numa partida, veterano, winrate, entry king, clutch master e mais -- os recordes da carreira inteira, direto no site.',
      botoes: [{ label: 'Ver recordes no site', url: linkHallDaFama() }],
    }));
  },
};
