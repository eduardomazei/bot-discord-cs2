// Deixou de montar embed com dado da planilha em 15/09/2026 (decisão de centralizar tudo no
// site, ver CLAUDE.md/memória do trupe-site) -- rank, Elo e progresso pro próximo rank já
// aparecem no perfil em /jogadores/<id> no site.
const { SlashCommandBuilder } = require('discord.js');
const { linkReplyPayload } = require('../../utils/linkReply');
const { linkJogador } = require('../../utils/siteLinks');

module.exports = {
  // exigeRegistro fica no default (true) -- mesma trava dos outros comandos de stats.

  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Mostra o link do rank/Elo do jogador no site')
    .addUserOption(opt =>
      opt.setName('usuario')
        .setDescription('Jogador para consultar o rank')
        .setRequired(false)
    ),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('usuario') || interaction.user;
    const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    const displayName = targetMember ? targetMember.displayName : targetUser.username;

    return interaction.reply(linkReplyPayload({
      titulo: `<:trupe_rank_mazei:1540075280838693075> Rank — ${displayName}`,
      corpo: 'Rank atual, progresso pro próximo e a escada completa -- tudo no perfil no site.',
      thumbnailUrl: targetUser.displayAvatarURL({ dynamic: true }),
      botoes: [{ label: 'Ver rank no site', url: linkJogador(targetUser.id) }],
    }));
  },
};
