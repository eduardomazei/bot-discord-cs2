const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { registrarAdvertencia } = require('../../utils/advertencias');

module.exports = {
  // exigeRegistro fica no default (true) -- 'advertir' não estava em
  // comandosLiberados no legado, então já exigia cadastro antes desta migração.

  data: new SlashCommandBuilder()
    .setName('advertir')
    .setDescription('[Owner/Directors] Aplica uma advertência a um jogador, com pontuação de acordo com o tipo')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(option =>
      option.setName('jogador')
        .setDescription('Jogador a ser advertido')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('tipo')
        .setDescription('Tipo de advertência (define quantos pontos serão adicionados)')
        .setRequired(true)
        .addChoices(
          { name: '🕐 Falta ou Atraso (1 ponto)', value: 'falta_atraso' },
          { name: '🚫 Falta de Respeito com ADM/Staff (2 pontos)', value: 'falta_respeito' },
          { name: '💢 Ragequit ou Troll (3 pontos)', value: 'ragequit_troll' }
        )
    )
    .addStringOption(option =>
      option.setName('motivo')
        .setDescription('Detalhes adicionais sobre o ocorrido (opcional)')
        .setRequired(false)
    ),

  // A lógica de leitura/escrita na planilha + cálculo de punição é compartilhada com /ausente --
  // ver registrarAdvertencia() em utils/advertencias.js.
  async execute(interaction) {
    return registrarAdvertencia(interaction, {
      tipoKey: interaction.options.getString('tipo'),
      motivoFixo: null,
    });
  },
};
