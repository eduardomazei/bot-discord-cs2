const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require('discord.js');
const { ehAdministrador } = require('../../utils/permissions');

module.exports = {
  // exigeRegistro fica no default (true) -- 'importar-partida' não estava em
  // comandosLiberados no legado, então já exigia cadastro antes desta migração.

  data: new SlashCommandBuilder()
    .setName('importar-partida')
    .setDescription('[Owner/Directors] Puxa o CSV do MatchZy via API e atualiza os Elos e Stats')
    // Esconde da lista de comandos de quem não tem Administrador (Owner/Directors/Founders/Trupe
    // já têm essa permissão -- ver utils/permissions.js). A checagem de verdade continua sendo
    // ehAdministrador() no handler; isso aqui só evita poluir a lista de quem não pode usar.
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  // O envio do formulário (customId modal_importar_partida) -- cálculo da partida, preview e os
  // botões Confirmar/Cancelar (ver docs/adr/0002-importar-partida-preview-antes-de-gravar.md) --
  // continua inteiro em legacy/interactionRouter.js. Ainda não existe loader de componentes
  // (select/modal) no padrão modular, então esse handler fica lá até essa peça da migração ser
  // construída. Ver docs/plans/modularizacao-index-js.md §6.
  async execute(interaction) {
    if (!(await ehAdministrador(interaction))) {
      return await interaction.reply({
        content: '<:trupe_erro:1536410911617843322> Apenas membros com o cargo **Owner** ou **Directors** podem usar este comando!',
        ephemeral: true
      });
    }

    const modal = new ModalBuilder()
      .setCustomId('modal_importar_partida')
      .setTitle('Importar Partida — MatchZy');

    const inputIdPartida = new TextInputBuilder()
      .setCustomId('input_id_partida')
      .setLabel('ID da Partida (MatchZy)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Ex: 55')
      .setRequired(true);

    const inputServidorId = new TextInputBuilder()
      .setCustomId('input_servidor_id')
      .setLabel('ID do Servidor (Opções abaixo)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('• a1b2c3d4 (Serv 1) • 3dc31c75 (Serv 2) • f4d76700 (Serv 3) • 832f29e5 (Serv 4)')
      .setRequired(true);

    const inputMapa = new TextInputBuilder()
      .setCustomId('input_mapa')
      .setLabel('Mapa (Opções abaixo)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('• de_mirage • de_dust2 • de_inferno • de_anubis • de_ancient • de_cache • de_nuke')
      .setRequired(true);

    const inputScoreA = new TextInputBuilder()
      .setCustomId('input_score_a')
      .setLabel('Placar Time A (Opcional - Padrão: 13)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Ex: 13')
      .setRequired(false);

    const inputScoreB = new TextInputBuilder()
      .setCustomId('input_score_b')
      .setLabel('Placar Time B (Opcional - Padrão: 0)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Ex: 9')
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder().addComponents(inputIdPartida),
      new ActionRowBuilder().addComponents(inputServidorId),
      new ActionRowBuilder().addComponents(inputMapa),
      new ActionRowBuilder().addComponents(inputScoreA),
      new ActionRowBuilder().addComponents(inputScoreB)
    );

    return await interaction.showModal(modal);
  },
};
