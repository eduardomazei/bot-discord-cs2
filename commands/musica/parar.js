const { SlashCommandBuilder } = require('discord.js');
const musicaService = require('../../services/musicaService');
const { buildContainer, componentsV2Payload } = require('../../utils/containers');
const { CORES } = require('../../utils/colors');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('parar')
    .setDescription('Para a música, limpa a fila e tira o bot do canal de voz'),

  async execute(interaction) {
    const parou = musicaService.encerrarEstado(interaction.guildId);

    const container = buildContainer({
      cor: parou ? CORES.SUCESSO : CORES.NEUTRO,
      titulo: '⏹️ Player encerrado',
      corpo: parou ? 'Música parada, fila limpa e saí do canal de voz.' : 'Não tinha nenhuma música tocando.',
    });
    return interaction.reply(componentsV2Payload(container, parou ? {} : { ephemeral: true }));
  },
};
