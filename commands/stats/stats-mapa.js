// Deixou de calcular as estatísticas por mapa com dado da planilha em 15/09/2026 (decisão de
// centralizar tudo no site, ver CLAUDE.md/memória do trupe-site). Sem filtro de jogador, aponta
// pra /resultados (filtra por mapa/mix/jogador direto na página -- não tem link profundo por
// mapa ainda); com jogador informado, aponta direto pro perfil dele, que já mostra melhor/pior
// mapa.
const { SlashCommandBuilder } = require('discord.js');
const { linkReplyPayload } = require('../../utils/linkReply');
const { linkJogador, linkResultados } = require('../../utils/siteLinks');

module.exports = {
  // exigeRegistro fica no default (true) -- 'stats-mapa' não estava em
  // comandosLiberados no legado, então já exigia cadastro antes desta migração.

  data: new SlashCommandBuilder()
    .setName('stats-mapa')
    .setDescription('Mostra o link das estatísticas por mapa no site')
    .addStringOption(option =>
      option.setName('mapa')
        .setDescription('Selecione o mapa')
        .setRequired(false)
        .addChoices(
          { name: 'Dust2', value: 'De_dust2' },
          { name: 'Mirage', value: 'De_mirage' },
          { name: 'Inferno', value: 'De_inferno' },
          { name: 'Nuke', value: 'De_nuke' },
          { name: 'Ancient', value: 'De_ancient' },
          { name: 'Anubis', value: 'De_anubis' },
          { name: 'Cache', value: 'De_cache' }
        )
    )
    .addUserOption(option =>
      option.setName('jogador')
        .setDescription('Ver estatísticas de um jogador específico no mapa')
        .setRequired(false)
    ),

  async execute(interaction) {
    const jogadorFiltro = interaction.options.getUser('jogador');

    if (jogadorFiltro) {
      const targetMember = await interaction.guild.members.fetch(jogadorFiltro.id).catch(() => null);
      const displayName = targetMember ? targetMember.displayName : jogadorFiltro.username;

      return interaction.reply(linkReplyPayload({
        titulo: `<:trupe_mapa_mazei:1536413320397979718> Estatísticas por mapa — ${displayName}`,
        corpo: 'Melhor e pior mapa, com KD e ADR por mapa -- tudo no perfil no site.',
        thumbnailUrl: jogadorFiltro.displayAvatarURL({ dynamic: true }),
        botoes: [{ label: 'Ver perfil no site', url: linkJogador(jogadorFiltro.id) }],
      }));
    }

    return interaction.reply(linkReplyPayload({
      titulo: '<:trupe_mapa_mazei:1536413320397979718> Estatísticas de mapas',
      corpo: 'Filtra por mapa, mix ou jogador direto na página de resultados no site.',
      botoes: [{ label: 'Ver resultados no site', url: linkResultados() }],
    }));
  },
};
