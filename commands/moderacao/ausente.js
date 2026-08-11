const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { registrarAdvertencia } = require('../../utils/advertencias');

module.exports = {
  // exigeRegistro fica no default (true) -- 'ausente' não estava em
  // comandosLiberados no legado, então já exigia cadastro antes desta migração.

  data: new SlashCommandBuilder()
    .setName('ausente')
    .setDescription('[Owner/Directors] Registra ausência/WO para um jogador que não compareceu ao jogo')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(option =>
      option.setName('jogador')
        .setDescription('Jogador ausente')
        .setRequired(true)
    ),

  // 'ausente' é literalmente '/advertir' com tipo e motivo fixos -- mesma lógica compartilhada
  // em registrarAdvertencia() (utils/advertencias.js).
  async execute(interaction) {
    return registrarAdvertencia(interaction, {
      tipoKey: 'falta_atraso',
      motivoFixo: 'Ausência / WO após confirmar presença',
    });
  },
};
