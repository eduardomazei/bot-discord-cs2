// Deixou de montar embed com dado da planilha em 15/09/2026 (decisão de centralizar tudo no
// site, ver CLAUDE.md/memória do trupe-site) -- perfil completo já mora em /jogadores/<id> no
// site (mais bonito, sempre atualizado, sem esse comando precisar ler Sheets/Supabase).
const { SlashCommandBuilder } = require('discord.js');
const { linkReplyPayload } = require('../../utils/linkReply');
const { linkJogador } = require('../../utils/siteLinks');

module.exports = {
  // exigeRegistro fica no default (true) -- 'player' não estava em comandosLiberados
  // no legado, então já exigia cadastro antes desta migração.

  data: new SlashCommandBuilder()
    .setName('player')
    .setDescription('Mostra o link do perfil do jogador no site')
    .addUserOption(option =>
      option.setName('usuario')
        .setDescription('Selecione o membro do Discord')
        .setRequired(false)
    ),

  async execute(interaction) {
    const targetUser = interaction.options.getUser('usuario') || interaction.user;
    const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    const displayName = targetMember ? targetMember.displayName : targetUser.username;

    return interaction.reply(linkReplyPayload({
      titulo: `<:trupe_teia:1536412408203976888> Perfil de ${displayName}`,
      corpo: 'Elo, rank, histórico de partidas e conquistas -- tudo no perfil no site.',
      thumbnailUrl: targetUser.displayAvatarURL({ dynamic: true }),
      botoes: [{ label: 'Ver perfil no site', url: linkJogador(targetUser.id) }],
    }));
  },
};
