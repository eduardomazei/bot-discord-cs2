// Deixou de montar o placar/estatísticas com dado da planilha em 15/09/2026 (decisão de
// centralizar tudo no site, ver CLAUDE.md/memória do trupe-site) -- a página pública da partida
// (/partidas/<matchId>) já mostra tudo isso, incluindo o link do replay quando existe.
// Único caso que ainda precisa de uma consulta é "id em branco = a mais recente" -- usa o
// Supabase (fonte de verdade das partidas hoje) só pra achar o matchid, não pra montar o resto.
const { SlashCommandBuilder } = require('discord.js');
const { MessageFlags } = require('../../utils/containers');
const { linkReplyPayload } = require('../../utils/linkReply');
const { linkPartida, linkResultados } = require('../../utils/siteLinks');
const { getSupabase } = require('../../utils/supabase');

module.exports = {
  // exigeRegistro fica no default (true) -- 'partida-info' não estava em
  // comandosLiberados no legado, então já exigia cadastro antes desta migração.

  data: new SlashCommandBuilder()
    .setName('partida-info')
    .setDescription('Mostra o link da partida no site')
    .addStringOption(option =>
      option.setName('id')
        .setDescription('ID da Partida (deixe em branco para ver a última)')
        .setRequired(false)
    ),

  async execute(interaction) {
    // A flag IsComponentsV2 precisa ser declarada já aqui -- não dá pra adicionar depois via editReply.
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

    try {
      let matchId = interaction.options.getString('id');

      if (!matchId) {
        const supabase = getSupabase();
        const { data, error } = await supabase
          .from('partidas')
          .select('matchid')
          .order('criado_em', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) throw new Error(error.message);
        if (!data) {
          return await interaction.editReply(linkReplyPayload({
            titulo: 'Sem partidas',
            corpo: '<:trupe_aviso:1536410370829328434> Nenhuma partida importada ainda.',
            botoes: [{ label: 'Ver resultados no site', url: linkResultados() }],
          }));
        }
        matchId = data.matchid;
      }

      return await interaction.editReply(linkReplyPayload({
        titulo: `<:trupe_mapa:1536413320397979718> Partida #${matchId}`,
        corpo: 'Placar, elenco, MVP e estatísticas completas da partida no site.\n-# Se o mesmo ID existir em mais de um servidor, o site mostra a mais recente com esse número.',
        botoes: [{ label: 'Ver partida no site', url: linkPartida(matchId) }],
      }));
    } catch (err) {
      console.error('Erro no /partida-info:', err);
      return await interaction.editReply(linkReplyPayload({
        titulo: 'Erro',
        corpo: '<:trupe_aviso:1536410370829328434> Erro ao buscar a última partida.',
        botoes: [{ label: 'Ver resultados no site', url: linkResultados() }],
      }));
    }
  },
};
