const { SlashCommandBuilder } = require('discord.js');
const musicaService = require('../../services/musicaService');
const { buildContainer, componentsV2Payload } = require('../../utils/containers');
const { CORES } = require('../../utils/colors');

module.exports = {
  data: new SlashCommandBuilder().setName('pular').setDescription('Pula para a próxima música da fila'),

  async execute(interaction) {
    const estado = musicaService.obterEstado(interaction.guildId);
    if (!estado || !estado.tocandoAgora) {
      const container = buildContainer({
        cor: CORES.AVISO,
        titulo: '⏭️ Nada tocando',
        corpo: 'Não tem nenhuma música tocando agora.',
      });
      return interaction.reply(componentsV2Payload(container, { ephemeral: true }));
    }

    const faixaAnterior = estado.tocandoAgora;
    musicaService.pular(interaction.guildId);

    const container = buildContainer({
      cor: CORES.SUCESSO,
      titulo: '⏭️ Música pulada',
      corpo: `**${faixaAnterior.titulo}** foi pulada.`,
    });
    return interaction.reply(componentsV2Payload(container));
  },
};
