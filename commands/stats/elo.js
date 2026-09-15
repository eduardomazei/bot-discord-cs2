// Deixou de montar embed com dado da planilha em 15/09/2026 (decisão de centralizar tudo no
// site, ver CLAUDE.md/memória do trupe-site) -- Elo e o gráfico de evolução já moram no perfil
// em /jogadores/<id> no site.
const { SlashCommandBuilder } = require('discord.js');
const { linkReplyPayload } = require('../../utils/linkReply');
const { linkJogador } = require('../../utils/siteLinks');

module.exports = {
  // exigeRegistro fica no default (true) -- 'elo' não estava em comandosLiberados
  // no legado, então já exigia cadastro antes desta migração.

  data: new SlashCommandBuilder()
    .setName('elo')
    .setDescription('Mostra o link do Elo do jogador no site')
    .addUserOption(opt =>
      opt.setName('usuario')
        .setDescription('Jogador para consultar o Elo')
        .setRequired(false)
    ),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('usuario') || interaction.user;
    const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    const displayName = targetMember ? targetMember.displayName : targetUser.username;

    return interaction.reply(linkReplyPayload({
      titulo: `<:trupe_elo_up:1536410866709176492> Elo — ${displayName}`,
      corpo: 'Elo atual e o gráfico de evolução partida a partida -- tudo no perfil no site.',
      thumbnailUrl: targetUser.displayAvatarURL({ dynamic: true }),
      botoes: [{ label: 'Ver Elo no site', url: linkJogador(targetUser.id) }],
    }));
  },
};
