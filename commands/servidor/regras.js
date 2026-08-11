const {
  SlashCommandBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} = require('discord.js');
const { buildContainer, componentsV2Payload } = require('../../utils/containers');
const { CORES } = require('../../utils/colors');

module.exports = {
  // Não exige cadastro prévio (/registrar) -- reproduz o bypass que hoje vem de
  // 'regras' estar em comandosLiberados no legado (legacy/interactionRouter.js).
  exigeRegistro: false,

  data: new SlashCommandBuilder()
    .setName('regras')
    .setDescription('Exibe o painel interativo de regras do Mix Trupe'),

  // O menu suspenso abaixo (customId 'select_regras') continua sendo tratado em
  // legacy/interactionRouter.js -- não existe ainda um loader de componentes
  // (select/modal/botão) no padrão modular, então esse handler fica lá até
  // que essa peça da migração exista. Ver docs/plans/modularizacao-index-js.md §6.
  async execute(interaction) {
    const selectMenu = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('select_regras')
        .setPlaceholder('📌 Clique aqui para escolher a categoria das regras...')
        .addOptions(
          new StringSelectMenuOptionBuilder()
            .setLabel('Conduta e Punições')
            .setDescription('Respeito, comportamento, advertências e proibições')
            .setValue('regras_conduta')
            .setEmoji('⚖️'),
          new StringSelectMenuOptionBuilder()
            .setLabel('Funcionamento da Presença e Servidores')
            .setDescription('Como jogar, confirmar presença, vetos e conexões')
            .setValue('regras_filas')
            .setEmoji('🎮'),
          new StringSelectMenuOptionBuilder()
            .setLabel('Sistema de Elo e Stats')
            .setDescription('Regras de pontuação, vitorias, derrotas e bônus')
            .setValue('regras_elo')
            .setEmoji('<a:trupe_trofeu:1536412945339129857>')
        )
    );

    await interaction.reply(componentsV2Payload(
      buildContainer({
        cor: CORES.ERRO,
        titulo: '<:trupe_teia:1536412408203976888> Central de Regras e Orientações — Mix Trupe CS2',
        corpo:
          'Seja bem-vindo ao **Mix Trupe**!\n\n' +
          'Selecione uma categoria no **menu suspenso abaixo** para visualizar as regras detalhadas sobre a comunidade, filas e pontuações.',
        rodape: 'Clique no menu abaixo para navegar',
        actionRows: [selectMenu],
      })
    ));
  },
};
