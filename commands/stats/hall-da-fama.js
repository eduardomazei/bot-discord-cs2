// Deixou de calcular os recordes com dado da planilha em 15/09/2026 (decisão de centralizar
// tudo no site, ver CLAUDE.md/memória do trupe-site). Não existe uma página única "hall da
// fama" no site ainda -- os destaques da temporada (maior ADR, kills, etc.) moram em /season e
// o ranking geral por Elo em /ranking, então aponta pros dois. Se o site ganhar uma página de
// recordes all-time dedicada, trocar aqui.
const { SlashCommandBuilder } = require('discord.js');
const { linkReplyPayload } = require('../../utils/linkReply');
const { linkSeason, linkRanking } = require('../../utils/siteLinks');

module.exports = {
  // exigeRegistro fica no default (true) -- 'hall-da-fama' não estava em
  // comandosLiberados no legado, então já exigia cadastro antes desta migração.

  data: new SlashCommandBuilder()
    .setName('hall-da-fama')
    .setDescription('Mostra o link dos destaques e do ranking no site'),

  async execute(interaction) {
    return interaction.reply(linkReplyPayload({
      titulo: '<:trupe_coroa_mazei:1537477117686718574> Hall da Fama — Mix Trupe',
      corpo: 'Maior ADR, mais kills e outros destaques da temporada estão em **Destaques**, na página da season. O ranking geral por Elo está em **Ranking**.',
      botoes: [
        { label: 'Destaques da season', url: linkSeason() },
        { label: 'Ranking', url: linkRanking() },
      ],
    }));
  },
};
