const { SlashCommandBuilder } = require('discord.js');
const musicaService = require('../../services/musicaService');
const { buildContainer, componentsV2Payload, MessageFlags } = require('../../utils/containers');
const { CORES } = require('../../utils/colors');

module.exports = {
  // exigeRegistro fica no default (true) -- só jogador registrado usa o player.

  data: new SlashCommandBuilder()
    .setName('tocar')
    .setDescription('Toca uma música no seu canal de voz (nome ou link do YouTube)')
    .addStringOption((opt) =>
      opt.setName('busca').setDescription('Nome da música ou link do YouTube').setRequired(true)
    ),

  async execute(interaction) {
    const canalVoz = interaction.member?.voice?.channel;
    if (!canalVoz) {
      const container = buildContainer({
        cor: CORES.AVISO,
        titulo: '🎵 Entre em um canal de voz',
        corpo: 'Você precisa estar em um canal de voz para usar esse comando.',
      });
      return interaction.reply(componentsV2Payload(container, { ephemeral: true }));
    }

    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

    try {
      const faixa = await musicaService.buscarFaixa(interaction.options.getString('busca'), interaction.user.id);

      if (!faixa) {
        const container = buildContainer({
          cor: CORES.ERRO,
          titulo: '🎵 Nada encontrado',
          corpo: 'Não encontrei nenhum resultado para essa busca.',
        });
        return interaction.editReply(componentsV2Payload(container));
      }

      const { estado, vaiComecarAgora } = musicaService.adicionarNaFila(
        interaction.guildId,
        canalVoz,
        interaction.channelId,
        faixa
      );

      const container = buildContainer({
        cor: CORES.SUCESSO,
        titulo: vaiComecarAgora ? '▶️ Tocando agora' : '🎵 Adicionado à fila',
        corpo:
          `**${faixa.titulo}**\n${faixa.autor} • ${faixa.duracao}` +
          (vaiComecarAgora ? '' : `\n\nPosição na fila: **${estado.fila.length}**`),
        rodape: `Pedido por ${interaction.member.displayName}`,
      });

      return interaction.editReply(componentsV2Payload(container));
    } catch (error) {
      console.error('Erro no /tocar:', error);
      const container = buildContainer({
        cor: CORES.ERRO,
        titulo: '🎵 Erro',
        corpo: 'Não consegui tocar essa música. Tente novamente ou use outro link/busca.',
      });
      return interaction.editReply(componentsV2Payload(container));
    }
  },
};
