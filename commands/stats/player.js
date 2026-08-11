const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getSheet } = require('../../utils/sheets');
const { buildContainer, componentsV2Payload, MessageFlags } = require('../../utils/containers');
const { CORES } = require('../../utils/colors');
const { rotuloServidor } = require('../../utils/servidores');

module.exports = {
  // exigeRegistro fica no default (true) -- 'player' não estava em comandosLiberados
  // no legado, então já exigia cadastro antes desta migração.

  data: new SlashCommandBuilder()
    .setName('player')
    .setDescription('Exibe as estatísticas e perfil do jogador no Mix')
    .addUserOption(option =>
      option.setName('usuario')
        .setDescription('Selecione o membro do Discord')
        .setRequired(false)
    ),

  async execute(interaction) {
    // A flag IsComponentsV2 precisa ser declarada já aqui -- não dá pra adicionar depois via editReply.
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

    const targetUser = interaction.options.getUser('usuario') || interaction.user;
    const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    const displayName = targetMember ? targetMember.displayName : targetUser.username;

    try {
      const sheet = await getSheet('Jogadores');
      const rows = await sheet.getRows();

      const playerRow = rows.find(r => r.get('discord_id') === targetUser.id);

      if (!playerRow) {
        return interaction.editReply(componentsV2Payload(
          buildContainer({
            cor: CORES.ERRO,
            titulo: 'Jogador não cadastrado',
            corpo: `<:trupe_erro:1536410911617843322> O jogador **${displayName}** ainda não realizou o cadastro via \`/registrar\`.`,
          })
        ));
      }

      const partidas = parseInt(playerRow.get('matchs') || 0);
      const vitorias = parseInt(playerRow.get('wins') || 0);
      const kills = parseInt(playerRow.get('kills') || 0);
      const deaths = parseInt(playerRow.get('deaths') || 0);
      const hs = parseInt(playerRow.get('head_shot_kills') || 0);
      const elo = playerRow.get('elo') || '1000';
      const steamid64 = playerRow.get('steamid64') || '';
      const linkFaceit = playerRow.get('link_faceit') || '';
      const linkGc = playerRow.get('link_gc') || '';

      const kd = deaths > 0 ? (kills / deaths).toFixed(2) : kills.toFixed(2);
      const hsPercent = kills > 0 ? ((hs / kills) * 100).toFixed(0) + '%' : '0%';
      const winrate = partidas > 0 ? ((vitorias / partidas) * 100).toFixed(0) + '%' : '0%';
      const advertencias = playerRow.get('Advertências') || '0';

      // Últimas partidas jogadas — busca em Stats_Partidas por discord_id OU steamid64, porque
      // um jogador que se registrou DEPOIS de já ter jogado tem as linhas antigas gravadas com
      // discord_id "NÃO_REGISTRADO" (mesma lógica de resolução tardia do
      // docs/adr/0001-elenco-partida-resolvido-em-tempo-de-leitura.md).
      const sheetStatsPlayer = await getSheet('Stats_Partidas');
      const rowsStatsPlayer = await sheetStatsPlayer.getRows();
      const partidasDoJogador = rowsStatsPlayer.filter(r =>
        r.get('discord_id') === targetUser.id ||
        (steamid64 && steamid64 !== 'N/A' && r.get('steamid64') === steamid64)
      );
      // A ordem das linhas é a ordem de gravação (importação) — as últimas do array são as mais recentes.
      const ultimasPartidas = partidasDoJogador.slice(-5).reverse();
      const listaPartidas = ultimasPartidas.length > 0
        ? ultimasPartidas
            .map(r => `• \`#${r.get('matchid')}\` — **${rotuloServidor(r.get('server_id'))}** — ${r.get('map') || 'N/I'}`)
            .join('\n') + (partidasDoJogador.length > 5 ? `\n*(mostrando as 5 mais recentes de ${partidasDoJogador.length})*` : '')
        : '*Nenhuma partida encontrada.*';

      const corpo = [
        `<:trupe_elo_up:1536410866709176492> **MMR / Elo**: ${elo} pts`,
        `🎮 **Partidas**: ${partidas}`,
        `<a:trupe_trofeu:1536412945339129857> **Vitórias**: ${vitorias} (${winrate})`,
        `<:trupe_kdr:1536410965111734313> **K/D Ratio**: ${kd}`,
        `<:trupe_crosshair:1536410637117292705> **Headshots %**: ${hsPercent}`,
        `<:trupe_kills:1536411018765402212> **Kills**: ${kills}`,
        `<:trupe_mortes:1536411384496267406> **Deaths**: ${deaths}`,
        `<:trupe_aviso:1536410370829328434> **Advertências**: ${advertencias}`,
        '',
        `🆔 **SteamID64**: ${steamid64 && steamid64 !== 'N/A' ? `\`${steamid64}\`` : '*Não informado*'}`,
        '',
        `<:trupe_mapa:1536413320397979718> **Últimas Partidas**`,
        listaPartidas,
        '*Use `/partida-info id:<numero> servidor:<Servidor X>` para ver os detalhes de uma partida.*',
      ].join('\n');

      // Botões interativos abaixo da mensagem
      const rowButtons = new ActionRowBuilder();

      if (steamid64 && steamid64 !== 'N/A') {
        rowButtons.addComponents(
          new ButtonBuilder()
            .setLabel('Steam Profile')
            .setStyle(ButtonStyle.Link)
            .setURL(`https://steamcommunity.com/profiles/${steamid64}`)
        );
      }

      if (linkFaceit && linkFaceit.startsWith('http')) {
        rowButtons.addComponents(
          new ButtonBuilder()
            .setLabel('FACEIT')
            .setStyle(ButtonStyle.Link)
            .setURL(linkFaceit)
        );
      }

      if (linkGc && linkGc.startsWith('http')) {
        rowButtons.addComponents(
          new ButtonBuilder()
            .setLabel('Gamers Club')
            .setStyle(ButtonStyle.Link)
            .setURL(linkGc)
        );
      }

      await interaction.editReply(componentsV2Payload(
        buildContainer({
          cor: CORES.SUCESSO,
          titulo: `<:trupe_teia:1536412408203976888> Perfil de ${displayName}`,
          corpo,
          thumbnailUrl: targetUser.displayAvatarURL({ dynamic: true }),
          rodape: 'Mix Trupe • Estatísticas do Servidor',
          actionRows: rowButtons.components.length > 0 ? [rowButtons] : [],
        })
      ));

    } catch (error) {
      console.error('Erro ao buscar player:', error);
      await interaction.editReply(componentsV2Payload(
        buildContainer({ cor: CORES.AVISO, titulo: 'Erro', corpo: '<:trupe_aviso:1536410370829328434> Erro ao consultar a planilha de dados.' })
      ));
    }
  },
};
