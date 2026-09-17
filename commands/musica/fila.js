const { SlashCommandBuilder } = require('discord.js');
const musicaService = require('../../services/musicaService');
const { buildContainer, componentsV2Payload } = require('../../utils/containers');
const { CORES } = require('../../utils/colors');

const MAX_LISTADAS = 10;

module.exports = {
  data: new SlashCommandBuilder().setName('fila').setDescription('Mostra a fila de músicas atual'),

  async execute(interaction) {
    const estado = musicaService.obterEstado(interaction.guildId);

    if (!estado || (!estado.tocandoAgora && estado.fila.length === 0)) {
      const container = buildContainer({
        cor: CORES.NEUTRO,
        titulo: '📃 Fila vazia',
        corpo: 'Não tem nenhuma música tocando ou na fila agora. Use `/tocar` para começar!',
      });
      return interaction.reply(componentsV2Payload(container, { ephemeral: true }));
    }

    const linhas = [];

    if (estado.tocandoAgora) {
      linhas.push(
        `▶️ **Tocando agora:** ${estado.tocandoAgora.titulo} — ${estado.tocandoAgora.duracao} _(pedido por <@${estado.tocandoAgora.pedidoPor}>)_`
      );
    }

    if (estado.fila.length) {
      linhas.push('', '**Próximas:**');
      estado.fila.slice(0, MAX_LISTADAS).forEach((faixa, i) => {
        linhas.push(`${i + 1}. ${faixa.titulo} — ${faixa.duracao} _(pedido por <@${faixa.pedidoPor}>)_`);
      });
      if (estado.fila.length > MAX_LISTADAS) {
        linhas.push(`_...e mais ${estado.fila.length - MAX_LISTADAS} música(s)._`);
      }
    }

    const container = buildContainer({
      cor: CORES.INFO,
      titulo: '📃 Fila de músicas',
      corpo: linhas.join('\n'),
    });

    return interaction.reply(componentsV2Payload(container));
  },
};
