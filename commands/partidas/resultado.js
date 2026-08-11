const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { ehAdministrador } = require('../../utils/permissions');
const { getSheet } = require('../../utils/sheets');
const { CORES } = require('../../utils/colors');

module.exports = {
  // exigeRegistro fica no default (true) -- 'resultado' não estava em
  // comandosLiberados no legado, então já exigia cadastro antes desta migração.

  data: new SlashCommandBuilder()
    .setName('resultado')
    .setDescription('[Owner/Directors] Registra o resultado da partida, atualizando Stats e Elo dos jogadores')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(opt =>
      opt.setName('id_partida')
        .setDescription('ID da partida (ex: 101)')
        .setRequired(true)
    )
    .addUserOption(opt =>
      opt.setName('jogador')
        .setDescription('Jogador para registrar os dados')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('mapa')
        .setDescription('Mapa jogado')
        .setRequired(true)
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
    .addStringOption(opt =>
      opt.setName('resultado_jogo')
        .setDescription('Se o jogador Venceu ou Perdeu a partida')
        .setRequired(true)
        .addChoices(
          { name: '🏆 Vitória', value: 'vitoria' },
          { name: '❌ Derrota', value: 'derrota' }
        )
    )
    .addIntegerOption(opt => opt.setName('kills').setDescription('Kills').setRequired(true))
    .addIntegerOption(opt => opt.setName('deaths').setDescription('Deaths').setRequired(true))
    .addIntegerOption(opt => opt.setName('assists').setDescription('Assists').setRequired(true))
    .addNumberOption(opt => opt.setName('adr').setDescription('ADR / Dano Médio por Round').setRequired(true)),

  async execute(interaction) {
    if (!(await ehAdministrador(interaction))) {
      return await interaction.reply({
        content: '<:trupe_erro:1536410911617843322> Apenas membros com o cargo **Owner** ou **Directors** podem usar este comando!',
        ephemeral: true
      });
    }

    await interaction.deferReply();

    try {
      const idPartida = interaction.options.getString('id_partida');
      const targetUser = interaction.options.getUser('jogador');
      const mapaJogado = interaction.options.getString('mapa');
      const resJogo = interaction.options.getString('resultado_jogo');
      const kills = interaction.options.getInteger('kills');
      const deaths = interaction.options.getInteger('deaths');
      const assists = interaction.options.getInteger('assists');
      const adr = interaction.options.getNumber('adr');

      const eVitoria = resJogo === 'vitoria';

      let bonusAdr = 0;
      if (adr > 100) bonusAdr = 5;
      else if (adr < 50) bonusAdr = -3;

      const variacaoElo = eVitoria ? (25 + bonusAdr) : (-20 + bonusAdr);

      const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
      const nick = targetMember ? targetMember.displayName : targetUser.username;

      const sheetStats = await getSheet('Stats_Partidas');
      const sheetJogadores = await getSheet('Jogadores');

      await sheetStats.addRow({
        'matchid': idPartida,
        'map': mapaJogado,
        'teamname': eVitoria ? 'Time Vencedor' : 'Time Derrotado',
        'steamid64': 'N/A',
        'discord_id': targetUser.id,
        'nick_discord': nick,
        'kills': kills.toString(),
        'head_shot_kills': '0',
        'deaths': deaths.toString(),
        'assists': assists.toString(),
        'damage': (adr * 24).toFixed(0),
        'utility_count': '0',
        'utility_damage': '0',
        'utility_successes': '0',
        'flash_count': '0',
        'flash_successes': '0',
        'enemies_flashed': '0',
        'entry_count': '0',
        'entry_wins': '0',
        'enemy2ks': '0',
        'enemy3ks': '0',
        'enemy4ks': '0',
        'enemy5ks': '0',
        'v1_count': '0',
        'v1_wins': '0',
        'v2_count': '0',
        'v2_wins': '0',
        'elo_diff': variacaoElo >= 0 ? `+${variacaoElo}` : `${variacaoElo}`
      });

      const rowsJogadores = await sheetJogadores.getRows();
      let rowJogador = rowsJogadores.find(r => r.get('discord_id') === targetUser.id);

      let eloAtual = 1000;
      let matchsAtual = 0;
      let winsAtual = 0;
      let killsAtual = 0;
      let deathsAtual = 0;
      let assistsAtual = 0;
      let damageAtual = 0;

      if (rowJogador) {
        eloAtual = parseInt(rowJogador.get('elo') || 1000);
        matchsAtual = parseInt(rowJogador.get('matchs') || 0);
        winsAtual = parseInt(rowJogador.get('wins') || 0);
        killsAtual = parseInt(rowJogador.get('kills') || 0);
        deathsAtual = parseInt(rowJogador.get('deaths') || 0);
        assistsAtual = parseInt(rowJogador.get('assists') || 0);
        damageAtual = parseInt(rowJogador.get('damage') || 0);

        const novoElo = Math.max(0, eloAtual + variacaoElo);

        rowJogador.set('elo', novoElo.toString());
        rowJogador.set('matchs', (matchsAtual + 1).toString());
        if (eVitoria) rowJogador.set('wins', (winsAtual + 1).toString());
        rowJogador.set('kills', (killsAtual + kills).toString());
        rowJogador.set('deaths', (deathsAtual + deaths).toString());
        rowJogador.set('assists', (assistsAtual + assists).toString());
        rowJogador.set('damage', (damageAtual + Math.round(adr * 24)).toString());

        await rowJogador.save();
      } else {
        const novoElo = Math.max(0, eloAtual + variacaoElo);
        await sheetJogadores.addRow({
          'discord_id': targetUser.id,
          'discord_nick': nick,
          'steamid64': 'N/A',
          'rank_trupe': 'C',
          'elo': novoElo.toString(),
          'matchs': '1',
          'wins': eVitoria ? '1' : '0',
          'kills': kills.toString(),
          'deaths': deaths.toString(),
          'assists': assists.toString(),
          'head_shot_kills': '0',
          'damage': (adr * 24).toFixed(0),
          'kast': '0',
          'Advertências': '0',
          'Punições': '0',
          'Banido_Até': '',
          'Banido_Temporada': '',
          'link_faceit': 'N/A',
          'link_gc': 'N/A'
        });
      }

      const strDiff = variacaoElo >= 0 ? `+${variacaoElo}` : `${variacaoElo}`;

      const embed = new EmbedBuilder()
        .setTitle(`<:trupe_teia:1536412408203976888> Resultado Registrado — Partida #${idPartida}`)
        .setColor(eVitoria ? CORES.SUCESSO : CORES.ERRO)
        .addFields(
          { name: '👤 Jogador', value: `<@${targetUser.id}>`, inline: true },
          { name: '<:trupe_mapa:1536413320397979718> Mapa', value: mapaJogado, inline: true },
          { name: '<a:trupe_trofeu:1536412945339129857> Resultado', value: eVitoria ? 'Vitória' : 'Derrota', inline: true },
          { name: '<:trupe_kdr:1536410965111734313> K / D / A', value: `${kills} / ${deaths} / ${assists} (${adr} ADR)`, inline: true },
          { name: '<:trupe_elo_up:1536410866709176492> Variação de Elo', value: `\`${strDiff}\` pts`, inline: true },
          { name: '<:trupe_elo_up:1536410866709176492> Novo Elo', value: `**${eloAtual + variacaoElo}** pts`, inline: true }
        )
        .setTimestamp();

      return await interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error('Erro ao registrar resultado:', err);
      return await interaction.editReply('<:trupe_aviso:1536410370829328434> Erro ao registrar resultado da partida na planilha.');
    }
  },
};
