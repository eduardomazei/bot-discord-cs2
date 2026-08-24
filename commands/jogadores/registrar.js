const { SlashCommandBuilder } = require('discord.js');
const { ehAdministrador } = require('../../utils/permissions');
const { construirModalRegistro } = require('../../utils/modalRegistro');

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
  // legacy/interactionRouter.js -- ainda não existe loader de componentes (select/modal/botão) no
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
    const modal = construirModalRegistro(targetId, registrandoOutro ? usuarioAlvo.username : null);

    return await interaction.showModal(modal);
  },
};
