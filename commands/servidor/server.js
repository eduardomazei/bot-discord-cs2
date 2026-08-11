const { SlashCommandBuilder } = require('discord.js');
const { buildContainer, componentsV2Payload } = require('../../utils/containers');
const { CORES } = require('../../utils/colors');

module.exports = {
  // Não exige cadastro prévio (/registrar) -- reproduz o bypass que hoje vem de
  // 'server' estar em comandosLiberados no legado (legacy/interactionRouter.js).
  exigeRegistro: false,

  data: new SlashCommandBuilder()
    .setName('server')
    .setDescription('Exibe os IPs dos servidores de CS2 da Trupe'),

  async execute(interaction) {
    const corpo = [
      '**🖥️ SERVIDOR 01**',
      '```connect 103.14.27.41:27001; password 000009```',
      '**🖥️ SERVIDOR 02**',
      '```connect 103.14.27.41:27002; password 000009```',
      '**🖥️ SERVIDOR 03**',
      '```connect 103.14.27.41:27003; password 605946```',
      '**🖥️ SERVIDOR 04**',
      '```connect 103.14.27.41:27004; password 860913```',
    ].join('\n');

    await interaction.reply(componentsV2Payload(
      buildContainer({
        cor: CORES.INFO,
        titulo: '<:trupe_teia:1536412408203976888> Servidores da Trupe (CS2)',
        corpo,
        rodape: 'Copie a linha do servidor desejado e cole no console do CS2',
      })
    ));
  },
};
