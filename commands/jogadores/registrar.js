const {
  SlashCommandBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
} = require('discord.js');
const { ehAdministrador } = require('../../utils/permissions');

module.exports = {
  // Não exige cadastro prévio -- reproduz o bypass que hoje vem de 'registrar' estar em
  // comandosLiberados no legado (legacy/interactionRouter.js). É o próprio comando de cadastro,
  // então travar nele criaria um lockout (precisa se cadastrar pra poder se cadastrar).
  exigeRegistro: false,

  data: new SlashCommandBuilder()
    .setName('registrar')
    .setDescription('Abre o formulário de cadastro para vincular suas contas de CS2')
    .addUserOption(option =>
      option.setName('usuario')
        .setDescription('[Owner/Directors] Cadastrar outro jogador em vez de você mesmo')
        .setRequired(false)
    ),

  // O envio do formulário (customId modal_registrar_<discordId>) continua sendo tratado em
  // legacy/interactionRouter.js -- ainda não existe loader de componentes (select/modal) no
  // padrão modular, então esse handler fica lá até essa peça da migração ser construída.
  // Ver docs/plans/modularizacao-index-js.md §6.
  async execute(interaction) {
    const usuarioAlvo = interaction.options.getUser('usuario');
    const registrandoOutro = usuarioAlvo && usuarioAlvo.id !== interaction.user.id;

    if (registrandoOutro && !(await ehAdministrador(interaction))) {
      return await interaction.reply({
        content: '<:trupe_erro:1536410911617843322> Apenas membros com o cargo **Owner** ou **Directors** podem cadastrar outro jogador!',
        ephemeral: true
      });
    }

    const targetId = registrandoOutro ? usuarioAlvo.id : interaction.user.id;

    const modal = new ModalBuilder()
      .setCustomId(`modal_registrar_${targetId}`)
      .setTitle(registrandoOutro ? `Cadastro de Jogador — ${usuarioAlvo.username}` : 'Cadastro de Jogador — Mix Trupe');

    const inputSteam = new TextInputBuilder()
      .setCustomId('input_steam')
      .setLabel('🎮 SteamID64 ou Link do Perfil Steam')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Ex: 76561198012345678 ou steamcommunity.com/id/seu_nick')
      .setMinLength(5)
      .setMaxLength(100)
      .setRequired(true);

    const inputFaceit = new TextInputBuilder()
      .setCustomId('input_faceit')
      .setLabel('🌐 Perfil FACEIT (Opcional)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Ex: faceit.com/pt/players/SeuNick')
      .setMaxLength(100)
      .setRequired(false);

    const inputGc = new TextInputBuilder()
      .setCustomId('input_gc')
      .setLabel('⚡ Perfil Gamers Club (Opcional)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Ex: gamersclub.com.br/player/12345')
      .setMaxLength(100)
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder().addComponents(inputSteam),
      new ActionRowBuilder().addComponents(inputFaceit),
      new ActionRowBuilder().addComponents(inputGc)
    );

    return await interaction.showModal(modal);
  },
};
