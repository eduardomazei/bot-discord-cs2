const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { ehAdministrador, replyNoPermission } = require('../../utils/permissions');

module.exports = {
  // Não exige cadastro prévio (/registrar) -- reproduz o bypass que hoje vem do
  // despacho antecipado dos comandos modulares em index.js. Ver docs/plans/modularizacao-index-js.md, seção 4.1.
  exigeRegistro: false,

  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Deleta mensagens do canal atual (apenas ADM)')
    .addIntegerOption((option) =>
      option
        .setName('quantidade')
        .setDescription('Quantidade de mensagens a deletar (máximo 100)')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(100)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  async execute(interaction) {
    try {
      if (!(await ehAdministrador(interaction))) {
        await replyNoPermission(interaction);
        return;
      }

      const quantidade = interaction.options.getInteger('quantidade');

      await interaction.deferReply({ ephemeral: true });

      const mensagensDeletadas = await interaction.channel.bulkDelete(quantidade, true);

      await interaction.editReply({
        content: `<:trupe_sucesso:1535757248930775041> **${mensagensDeletadas.size}** mensagem(ns) deletada(s) com sucesso.`,
      });
    } catch (error) {
      console.error('Erro no /clear:', error);
      try {
        const payload = {
          content: '<:trupe_erro:1535757225631686686> Ocorreu um erro ao deletar as mensagens. Mensagens com mais de 14 dias não podem ser deletadas em massa.',
          ephemeral: true,
        };
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply(payload);
        } else {
          await interaction.reply(payload);
        }
      } catch (fallbackError) {
        console.error('Falha ao enviar mensagem de erro do /clear:', fallbackError);
      }
    }
  },
};
