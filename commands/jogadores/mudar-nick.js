const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { ehAdministrador } = require('../../utils/permissions');

module.exports = {
  // exigeRegistro fica no default (true) -- 'mudar-nick' não estava em comandosLiberados
  // no legado, então já exigia cadastro antes desta migração.

  data: new SlashCommandBuilder()
    .setName('mudar-nick')
    .setDescription('[Owner/Directors] Altera o apelido de um membro do servidor')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(option =>
      option.setName('usuario')
        .setDescription('Membro que terá o nick alterado')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('novo_nick')
        .setDescription('Novo apelido para o membro')
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!(await ehAdministrador(interaction))) {
      return await interaction.reply({
        content: '<:trupe_erro:1536410911617843322> Apenas membros com o cargo **Owner** ou **Directors** podem alterar o nick de outros membros!',
        ephemeral: true
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const targetUser = interaction.options.getUser('usuario');
    const newNick = interaction.options.getString('novo_nick');

    try {
      const member = await interaction.guild.members.fetch(targetUser.id);

      if (!member) {
        return interaction.editReply({ content: '<:trupe_erro:1536410911617843322> Membro não encontrado neste servidor.' });
      }

      await member.setNickname(newNick);

      await interaction.editReply({
        content: `<:trupe_sucesso:1536412279778574356> Apelido de <@${targetUser.id}> alterado com sucesso para **${newNick}**!`
      });

    } catch (error) {
      console.error('Erro ao mudar nick:', error);
      await interaction.editReply({
        content: '<:trupe_erro:1536410911617843322> Ocorreu um erro ao alterar o apelido. Verifique se o cargo do Bot está **acima** do cargo do membro na hierarquia do Discord.'
      });
    }
  },
};
