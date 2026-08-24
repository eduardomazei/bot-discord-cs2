const { SlashCommandBuilder } = require('discord.js');
const { componentsV2Payload } = require('../../utils/containers');
const { construirPainelRegras } = require('../../utils/painelRegras');

module.exports = {
  // Não exige cadastro prévio (/registrar) -- reproduz o bypass que hoje vem de
  // 'regras' estar em comandosLiberados no legado (legacy/interactionRouter.js).
  exigeRegistro: false,

  data: new SlashCommandBuilder()
    .setName('regras')
    .setDescription('Exibe o painel interativo de regras do Mix Trupe'),

  // O menu suspenso (customId 'select_regras') e o botão "Concordo" (customId 'regras_concordo')
  // continuam tratados em legacy/interactionRouter.js -- não existe ainda um loader de
  // componentes no padrão modular. Ver docs/plans/modularizacao-index-js.md §6.
  async execute(interaction) {
    await interaction.reply(componentsV2Payload(construirPainelRegras()));
  },
};
