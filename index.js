require('dotenv').config();
const { 
  Client, 
  GatewayIntentBits, 
  REST, 
  Routes, 
  SlashCommandBuilder, 
  EmbedBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType
} = require('discord.js');
const { JWT } = require('google-auth-library');
const { GoogleSpreadsheet } = require('google-spreadsheet');

// --- IMPORTAÇÃO DO SERVIÇO DE PARTIDAS (FIREGAMES) ---
const { processarPartidaFiregames } = require('./firegamesService');

// --- CONFIGURAÇÃO DE CONSTANTES ---
const MAX_ADVERTENCIAS = 3;

// IDs exatos dos cargos ADM e Founder do seu servidor
const CARGOS_ADM_IDS = [
  '1512258415395864807', // ID do ADM
  '1488585835937923165'  // ID do Founder
];

// --- FUNÇÃO AUXILIAR: VERIFICA SE O MEMBRO POSSUI CARGO ADMINISTRATIVO ---
async function ehAdministrador(interaction) {
  try {
    if (!interaction.member) return false;

    // 1. Checa se o usuário possui a permissão nativa de Administrador no servidor
    if (interaction.member.permissions && interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return true;
    }

    // 2. Checa via array/collection de IDs de cargos recebido na interação
    const memberRoleIds = Array.isArray(interaction.member.roles)
      ? interaction.member.roles
      : Array.from(interaction.member.roles.cache.keys());

    const temCargoAutorizado = memberRoleIds.some(roleId => CARGOS_ADM_IDS.includes(roleId));
    if (temCargoAutorizado) return true;

    // 3. Fallback: faz o fetch atualizado do membro no servidor caso o cache venha frio
    const fetchedMember = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (fetchedMember) {
      return fetchedMember.roles.cache.some(role => CARGOS_ADM_IDS.includes(role.id));
    }

    return false;
  } catch (error) {
    console.error('Erro ao verificar permissão de administrador:', error);
    return false;
  }
}

// Estado Global da Fila e Presença em Memória
let filaConfig = {
  capacidade: 10,
  jogadores: [] // { id: string, name: string }
};

let listaPresenca = []; // { id: string, name: string }

// --- CONFIGURAÇÃO DO GOOGLE SHEETS ---
const auth = new JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const doc = new GoogleSpreadsheet(process.env.SPREADSHEET_ID, auth);

async function getSheet(title) {
  await doc.loadInfo();
  const sheet = doc.sheetsByTitle[title];
  if (sheet) await sheet.loadHeaderRow();
  return sheet;
}

// --- FUNÇÃO AUXILIAR: VERIFICA SE O JOGADOR ESTÁ REGISTRADO ---
async function jogadorEstaRegistrado(discordId) {
  try {
    const sheet = await getSheet('Jogadores');
    const rows = await sheet.getRows();
    const pRow = rows.find(r => r.get('discord_id') === discordId);
    
    return !!(pRow && pRow.get('steamid64') && pRow.get('steamid64') !== 'N/A');
  } catch (err) {
    console.error('Erro ao verificar registro do jogador:', err);
    return false;
  }
}

// --- CLIENTE DISCORD ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
  ],
});

// --- DEFINIÇÃO DOS SLASH COMMANDS ---
const commands = [
  // --- IMPORTAÇÃO AUTOMÁTICA DE PARTIDAS (FIREGAMES / PTERODACTYL) [ADM] ---
  new SlashCommandBuilder()
    .setName('importar-partida')
    .setDescription('[ADM] Puxa o CSV do MatchZy via API e atualiza os Elos e Stats')
    .addStringOption(opt => opt.setName('id_partida').setDescription('ID do MatchZy (ex: 55)').setRequired(true))
    .addStringOption(opt => opt.setName('servidor_id').setDescription('ID do Servidor no Pterodactyl').setRequired(true))
    .addStringOption(opt => opt.setName('mapa').setDescription('Nome do Mapa jogado').setRequired(true))
    .addIntegerOption(opt => opt.setName('score_a').setDescription('Placar Time A (ex: 13)').setRequired(false))
    .addIntegerOption(opt => opt.setName('score_b').setDescription('Placar Time B (ex: 9)').setRequired(false)),

  // --- FILA AUTOMÁTICA & PRESENÇA ---
  new SlashCommandBuilder()
    .setName('fila')
    .setDescription('Gerenciamento da Fila do Mix')
    .addSubcommand(sub =>
      sub.setName('entrar')
        .setDescription('Entra na fila de espera para o próximo Mix')
    )
    .addSubcommand(sub =>
      sub.setName('sair')
        .setDescription('Sai da fila de espera')
    )
    .addSubcommand(sub =>
      sub.setName('status')
        .setDescription('Exibe os jogadores atualmente na fila')
    )
    .addSubcommand(sub =>
      sub.setName('criar')
        .setDescription('[ADM] Configura uma nova fila com limite de vagas personalizadas')
        .addIntegerOption(opt =>
          opt.setName('vagas')
            .setDescription('Número total de vagas (ex: 10)')
            .setRequired(true)
        )
    ),

  new SlashCommandBuilder()
    .setName('presenca')
    .setDescription('Confirmação de presença antecipada para o Mix de amanhã/hoje')
    .addStringOption(opt =>
      opt.setName('acao')
        .setDescription('Confirmar ou remover sua presença')
        .setRequired(true)
        .addChoices(
          { name: '✅ Confirmar Presença', value: 'confirmar' },
          { name: '❌ Cancelar Presença', value: 'cancelar' },
          { name: '📋 Ver Lista', value: 'lista' }
        )
    ),

  // --- REPORTE DE PARTIDA E CÁLCULO DE ELO MANUAL [ADM] ---
  new SlashCommandBuilder()
    .setName('resultado')
    .setDescription('[ADM] Registra o resultado da partida, atualizando Stats e Elo dos jogadores')
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

  // --- ELO & PLAYER ---
  new SlashCommandBuilder()
    .setName('elo')
    .setDescription('Exibe a pontuação de Elo e histórico de performance de um jogador')
    .addUserOption(opt =>
      opt.setName('usuario')
        .setDescription('Jogador para consultar o Elo')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('player')
    .setDescription('Exibe as estatísticas e informações de um jogador no Mix')
    .addUserOption(option =>
      option.setName('usuario')
        .setDescription('Selecione o membro do Discord')
        .setRequired(false)
    ),

  // --- ESTATÍSTICAS AVANÇADAS ---
  new SlashCommandBuilder()
    .setName('hall-da-fama')
    .setDescription('Exibe os recordes históricos da comunidade (Maior ADR, Kills, Winrate)'),

  new SlashCommandBuilder()
    .setName('x1')
    .setDescription('Compara o histórico head-to-head entre você e outro jogador')
    .addUserOption(opt =>
      opt.setName('adversario')
        .setDescription('Selecione o jogador para comparar estatísticas')
        .setRequired(true)
    ),

  // --- AUTOMAÇÃO DE VOZ [ADM] ---
  new SlashCommandBuilder()
    .setName('mover-times')
    .setDescription('[ADM] Move automaticamente os dois times para as salas de voz especificadas')
    .addChannelOption(opt =>
      opt.setName('canal_time_a')
        .setDescription('Canal de voz do Time A (CT)')
        .setRequired(true)
    )
    .addChannelOption(opt =>
      opt.setName('canal_time_b')
        .setDescription('Canal de voz do Time B (TR)')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('reunir')
    .setDescription('[ADM] Move todos os jogadores dos canais de time de volta para o Lobby')
    .addChannelOption(opt =>
      opt.setName('canal_lobby')
        .setDescription('Canal de voz do Lobby principal')
        .setRequired(true)
    ),

  // --- COMANDOS DIVERSOS ---
  new SlashCommandBuilder()
    .setName('sortear')
    .setDescription('Sorteia e balanceia os jogadores da sala de voz em dois times de CS2'),

  new SlashCommandBuilder()
    .setName('registrar')
    .setDescription('Vincule o seu SteamID64 ao bot para registrar suas partidas do Mix')
    .addStringOption(option =>
      option.setName('steamid')
        .setDescription('Cole seu SteamID64 ou o link do seu perfil da Steam')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('ranking')
    .setDescription('Exibe o Leaderboard com o Top 10 jogadores do Mix Trupe'),

  new SlashCommandBuilder()
    .setName('stats-mapa')
    .setDescription('Exibe estatísticas da comunidade ou de um jogador filtradas por mapa')
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

  new SlashCommandBuilder()
    .setName('partida-info')
    .setDescription('Exibe as informações e placar de uma partida específica')
    .addStringOption(option =>
      option.setName('id')
        .setDescription('ID da Partida (deixe em branco para ver a última)')
        .setRequired(false)
    ),

  // --- MODERAÇÃO & ADVERTÊNCIAS [ADM] ---
  new SlashCommandBuilder()
    .setName('advertir')
    .setDescription('[ADM] Aplica uma advertência a um jogador por WO, Toxicity ou RageQuit')
    .addUserOption(option =>
      option.setName('jogador')
        .setDescription('Jogador a ser advertido')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('motivo')
        .setDescription('Motivo da advertência')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('ausente')
    .setDescription('[ADM] Registra ausência/WO para um jogador que não compareceu ao jogo')
    .addUserOption(option =>
      option.setName('jogador')
        .setDescription('Jogador ausente')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('desadvertir')
    .setDescription('[ADM] Remove uma advertência de um jogador')
    .addUserOption(option =>
      option.setName('jogador')
        .setDescription('Jogador')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('pick')
    .setDescription('Inicia o sistema de Veto de Mapas (Pick & Ban)')
    .addStringOption(option =>
      option.setName('modo')
        .setDescription('Selecione o formato da partida')
        .setRequired(true)
        .addChoices(
          { name: 'MD1 (Melhor de 1)', value: 'MD1' },
          { name: 'MD3 (Melhor de 3)', value: 'MD3' }
        )
    )
    .addUserOption(option =>
      option.setName('capitao_a')
        .setDescription('Capitão do Time A')
        .setRequired(false)
    )
    .addUserOption(option =>
      option.setName('capitao_b')
        .setDescription('Capitão do Time B')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('conectar')
    .setDescription('Exibe os IPs e botões de conexão rápida dos servidores do Mix Trupe'),

  new SlashCommandBuilder()
    .setName('server')
    .setDescription('Exibe os IPs e botões de conexão rápida dos servidores do Mix Trupe'),

  new SlashCommandBuilder()
    .setName('regras')
    .setDescription('Exibe as regras e funcionamento do Mix Trupe'),

  new SlashCommandBuilder()
    .setName('mudar-nick')
    .setDescription('[ADM] Altera o apelido de um membro do servidor')
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
];

// --- REGISTRO DE COMANDOS ---
const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

client.once('clientReady', async () => {
  try {
    console.log('🔄 Atualizando comandos (/)...');

    if (process.env.GUILD_ID) {
      await rest.put(Routes.applicationCommands(client.user.id), { body: [] });
      await rest.put(
        Routes.applicationGuildCommands(client.user.id, process.env.GUILD_ID),
        { body: commands }
      );
      console.log(`🤖 Bot online como ${client.user.tag}! Comandos sincronizados no servidor.`);
    }
  } catch (error) {
    console.error('Erro ao registrar comandos:', error);
  }
});

// --- EXECUÇÃO DOS COMANDOS ---
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  // --- TRAVA DE SEGURANÇA: EXIGE CADASTRO /REGISTRAR ---
  const comandosLiberados = ['registrar', 'regras', 'conectar', 'server'];

  if (!comandosLiberados.includes(commandName)) {
    const registrado = await jogadorEstaRegistrado(interaction.user.id);

    if (!registrado) {
      const embedTrava = new EmbedBuilder()
        .setTitle('🔒 Acesso Negado!')
        .setColor(0xE74C3C)
        .setDescription(
          `Olá <@${interaction.user.id}>! Para utilizar qualquer comando do bot e participar do **Mix Trupe**, você precisa vincular o seu **SteamID64** primeiro.\n\n` +
          `👉 Execute o comando abaixo para liberar o seu acesso:\n` +
          `\`\`\`\n/registrar steamid:SEU_STEAMID64_OU_LINK_STEAM\n\`\`\``
        )
        .setFooter({ text: 'Sistema de Proteção e Estatísticas do Mix Trupe' });

      return await interaction.reply({ embeds: [embedTrava], ephemeral: true });
    }
  }

  // --- COMANDO /IMPORTAR-PARTIDA (AUTOMÁTICO VIA PTERODACTYL) [ADM] ---
  if (commandName === 'importar-partida') {
    if (!(await ehAdministrador(interaction))) {
      return await interaction.reply({ 
        content: '❌ Apenas membros com o cargo **ADM** ou **Founder** podem usar este comando!', 
        ephemeral: true 
      });
    }

    await interaction.deferReply();
    const idPartida = interaction.options.getString('id_partida');
    const servidorId = interaction.options.getString('servidor_id');
    const mapa = interaction.options.getString('mapa');
    const scoreA = interaction.options.getInteger('score_a') ?? 13;
    const scoreB = interaction.options.getInteger('score_b') ?? 0;

    try {
      await processarPartidaFiregames(idPartida, servidorId, mapa, doc, scoreA, scoreB);
      return await interaction.editReply(`✅ **Partida #${idPartida}** importada com sucesso! Placar registrado: **${scoreA} x ${scoreB}**.`);
    } catch (err) {
      console.error(err);
      return await interaction.editReply(`❌ **Erro ao importar partida:** ${err.message}`);
    }
  }

  // --- COMANDO /RESULTADO (REGISTRO MANUAL E ELO) [ADM] ---
  if (commandName === 'resultado') {
    if (!(await ehAdministrador(interaction))) {
      return await interaction.reply({ 
        content: '❌ Apenas membros com o cargo **ADM** ou **Founder** podem usar este comando!', 
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

      // 1. Registra linha na aba Stats_Partidas
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

      // 2. Atualiza dados acumulados na aba Jogadores
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
          'Advertências': '0'
        });
      }

      const strDiff = variacaoElo >= 0 ? `+${variacaoElo}` : `${variacaoElo}`;

      const embed = new EmbedBuilder()
        .setTitle(`📊 Resultado Registrado — Partida #${idPartida}`)
        .setColor(eVitoria ? 0x2ECC71 : 0xE74C3C)
        .addFields(
          { name: '👤 Jogador', value: `<@${targetUser.id}>`, inline: true },
          { name: '🗺️ Mapa', value: mapaJogado, inline: true },
          { name: '🏆 Resultado', value: eVitoria ? 'Vitória' : 'Derrota', inline: true },
          { name: '⚔️ K / D / A', value: `${kills} / ${deaths} / ${assists} (${adr} ADR)`, inline: true },
          { name: '🔥 Variação de Elo', value: `\`${strDiff}\` pts`, inline: true },
          { name: '🎖️ Novo Elo', value: `**${eloAtual + variacaoElo}** pts`, inline: true }
        )
        .setTimestamp();

      return await interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error('Erro ao registrar resultado:', err);
      return await interaction.editReply('⚠️ Erro ao registrar resultado da partida na planilha.');
    }
  }

  // --- COMANDO /FILA ---
  if (commandName === 'fila') {
    const sub = interaction.options.getSubcommand();

    if (sub === 'criar') {
      if (!(await ehAdministrador(interaction))) {
        return await interaction.reply({ 
          content: '❌ Apenas membros com o cargo **ADM** ou **Founder** podem criar/alterar a fila!', 
          ephemeral: true 
        });
      }

      const vagas = interaction.options.getInteger('vagas');
      filaConfig.capacidade = vagas;
      filaConfig.jogadores = [];

      const embed = new EmbedBuilder()
        .setTitle('🎮 Nova Fila Criada!')
        .setColor(0x3498DB)
        .setDescription(`Fila configurada para **${vagas} vagas**. Use \`/fila entrar\` para garantir sua vaga!`);

      return await interaction.reply({ embeds: [embed] });
    }

    if (sub === 'entrar') {
      await interaction.deferReply();

      try {
        const sheetJogadores = await getSheet('Jogadores');
        const rows = await sheetJogadores.getRows();
        const pRow = rows.find(r => r.get('discord_id') === interaction.user.id);

        if (pRow && parseInt(pRow.get('Advertências') || 0) >= MAX_ADVERTENCIAS) {
          return await interaction.editReply({
            content: `🚫 **Acesso Negado!** Você possui **${pRow.get('Advertências')} advertências** ativas e está bloqueado de entrar na fila.`
          });
        }
      } catch (err) {
        console.error('Erro na checagem da fila:', err);
      }

      if (filaConfig.jogadores.some(p => p.id === interaction.user.id)) {
        return await interaction.editReply({ content: '⚠️ Você já está na fila!' });
      }

      if (filaConfig.jogadores.length >= filaConfig.capacidade) {
        return await interaction.editReply({ content: '❌ A fila já está cheia!' });
      }

      const displayName = interaction.member ? interaction.member.displayName : interaction.user.username;
      filaConfig.jogadores.push({ id: interaction.user.id, name: displayName });

      const faltam = filaConfig.capacidade - filaConfig.jogadores.length;

      if (faltam === 0) {
        const mencoes = filaConfig.jogadores.map(p => `<@${p.id}>`).join(' ');
        const listaNomes = filaConfig.jogadores.map((p, i) => `**${i + 1}.** ${p.name}`).join('\n');

        const embedStart = new EmbedBuilder()
          .setTitle('🚀 FILA CHEIA! PARTIDA PRONTA!')
          .setColor(0x2ECC71)
          .setDescription(`**Jogadores Confirmados:**\n${listaNomes}\n\n⚔️ Use \`/sortear\` ou \`/pick\` para organizar os times e vetos!`)
          .setTimestamp();

        filaConfig.jogadores = [];

        return await interaction.editReply({ content: `🔔 ${mencoes}`, embeds: [embedStart] });
      }

      const embed = new EmbedBuilder()
        .setTitle('✅ Entrou na Fila!')
        .setColor(0x00FF7F)
        .setDescription(`**${displayName}** entrou na fila.\n Status: \`[${filaConfig.jogadores.length}/${filaConfig.capacidade}]\` — Faltam **${faltam}** jogador(es)!`);

      return await interaction.editReply({ embeds: [embed] });
    }

    if (sub === 'sair') {
      const idx = filaConfig.jogadores.findIndex(p => p.id === interaction.user.id);
      if (idx === -1) {
        return await interaction.reply({ content: '⚠️ Você não está na fila.', ephemeral: true });
      }

      filaConfig.jogadores.splice(idx, 1);
      return await interaction.reply({
        content: `👋 Você saiu da fila. Status atual: \`[${filaConfig.jogadores.length}/${filaConfig.capacidade}]\``
      });
    }

    if (sub === 'status') {
      const lista = filaConfig.jogadores.map((p, i) => `**${i + 1}.** ${p.name}`).join('\n') || '*Nenhum jogador na fila.*';

      const embed = new EmbedBuilder()
        .setTitle(`📋 Status da Fila [${filaConfig.jogadores.length}/${filaConfig.capacidade}]`)
        .setColor(0x3498DB)
        .setDescription(lista)
        .setFooter({ text: 'Use /fila entrar para participar!' });

      return await interaction.reply({ embeds: [embed] });
    }
  }

  // --- COMANDO /PRESENCA ---
  if (commandName === 'presenca') {
    const acao = interaction.options.getString('acao');
    const displayName = interaction.member ? interaction.member.displayName : interaction.user.username;

    if (acao === 'confirmar') {
      if (listaPresenca.some(p => p.id === interaction.user.id)) {
        return await interaction.reply({ content: '⚠️ Você já confirmou sua presença!', ephemeral: true });
      }

      listaPresenca.push({ id: interaction.user.id, name: displayName });
      
      const embed = new EmbedBuilder()
        .setTitle('✅ Presença Confirmada!')
        .setColor(0x2ECC71)
        .setDescription(`**${displayName}** confirmou presença no próximo Mix!\nTotal de confirmados: **${listaPresenca.length}**`);

      return await interaction.reply({ embeds: [embed] });
    }

    if (acao === 'cancelar') {
      const idx = listaPresenca.findIndex(p => p.id === interaction.user.id);
      if (idx === -1) {
        return await interaction.reply({ content: '⚠️ Sua presença não estava confirmada.', ephemeral: true });
      }

      listaPresenca.splice(idx, 1);
      return await interaction.reply({ content: `❌ **${displayName}** cancelou a presença. Total de confirmados: **${listaPresenca.length}**` });
    }

    if (acao === 'lista') {
      const lista = listaPresenca.map((p, i) => `**${i + 1}.** ${p.name}`).join('\n') || '*Nenhuma presença confirmada ainda.*';

      const embed = new EmbedBuilder()
        .setTitle(`📅 Confirmados para o Próximo Mix (${listaPresenca.length})`)
        .setColor(0xF1C40F)
        .setDescription(lista)
        .setFooter({ text: 'Use /presenca confirmar para garantir sua vaga antecedente!' });

      return await interaction.reply({ embeds: [embed] });
    }
  }

  // --- COMANDO /ELO ---
  if (commandName === 'elo') {
    await interaction.deferReply();

    const targetUser = interaction.options.getUser('usuario') || interaction.user;
    const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    const displayName = targetMember ? targetMember.displayName : targetUser.username;

    try {
      const sheet = await getSheet('Jogadores');
      const rows = await sheet.getRows();

      const pRow = rows.find(r => r.get('discord_id') === targetUser.id);

      if (!pRow) {
        return await interaction.editReply(`❌ O jogador **${displayName}** ainda não possui cadastro via \`/registrar\`.`);
      }

      const elo = pRow.get('elo') || '1000';
      const partidas = parseInt(pRow.get('matchs') || 0);
      const vitorias = parseInt(pRow.get('wins') || 0);

      const embed = new EmbedBuilder()
        .setTitle(`🎖️ Pontuação de Elo — ${displayName}`)
        .setColor(0x9B59B6)
        .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
        .addFields(
          { name: '🔥 Elo / MMR Atual', value: `**${elo}** pts`, inline: true },
          { name: '🎮 Partidas Jogadas', value: `${partidas}`, inline: true },
          { name: '🏆 Vitórias', value: `${vitorias}`, inline: true }
        )
        .setFooter({ text: 'Vitória: +20~30 Elo | Derrota: -20~30 Elo' })
        .setTimestamp();

      return await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('Erro no /elo:', err);
      return await interaction.editReply('⚠️ Erro ao consultar pontuação de Elo.');
    }
  }

  // --- COMANDO /HALL-DA-FAMA ---
  if (commandName === 'hall-da-fama') {
    await interaction.deferReply();

    try {
      const sheetStats = await getSheet('Stats_Partidas');
      const sheetJogadores = await getSheet('Jogadores');

      const rowsStats = await sheetStats.getRows();
      const rowsJogadores = await sheetJogadores.getRows();

      let maiorADR = { nick: 'N/A', val: 0, mapa: 'N/A' };
      let maiorKills = { nick: 'N/A', val: 0, mapa: 'N/A' };

      rowsStats.forEach(r => {
        const damage = parseFloat(r.get('damage') || 0);
        const adr = damage / 24;
        const kills = parseInt(r.get('kills') || 0);
        const nick = r.get('nick_discord') || 'Jogador';
        const mapa = r.get('map') || 'Geral';

        if (adr > maiorADR.val) maiorADR = { nick, val: adr, mapa };
        if (kills > maiorKills.val) maiorKills = { nick, val: kills, mapa };
      });

      let maiorWinrate = { nick: 'N/A', val: 0, partidas: 0 };
      rowsJogadores.forEach(r => {
        const partidas = parseInt(r.get('matchs') || 0);
        const vitorias = parseInt(r.get('wins') || 0);
        if (partidas >= 5) {
          const wr = (vitorias / partidas) * 100;
          if (wr > maiorWinrate.val) {
            maiorWinrate = { nick: r.get('discord_nick') || 'Jogador', val: wr, partidas };
          }
        }
      });

      const embed = new EmbedBuilder()
        .setTitle('🏆 Hall da Fama — Mix Trupe CS2')
        .setColor(0xF1C40F)
        .addFields(
          { 
            name: '💥 Maior Dano / ADR em 1 Partida', 
            value: maiorADR.val > 0 ? `👑 **${maiorADR.nick}** — **${maiorADR.val.toFixed(1)}** ADR *(${maiorADR.mapa})*` : 'N/A',
            inline: false 
          },
          { 
            name: '🔫 Maior Número de Kills em 1 Partida', 
            value: maiorKills.val > 0 ? `👑 **${maiorKills.nick}** — **${maiorKills.val}** Kills *(${maiorKills.mapa})*` : 'N/A',
            inline: false 
          },
          { 
            name: '👑 Maior Winrate do Servidor (mín. 5 jogos)', 
            value: maiorWinrate.val > 0 ? `👑 **${maiorWinrate.nick}** — **${maiorWinrate.val.toFixed(0)}%** *(${maiorWinrate.partidas} jogos)*` : 'N/A',
            inline: false 
          }
        )
        .setFooter({ text: 'Recordes históricos gravados via Google Sheets' })
        .setTimestamp();

      return await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('Erro no /hall-da-fama:', err);
      return await interaction.editReply('⚠️ Erro ao calcular estatísticas do Hall da Fama.');
    }
  }

  // --- COMANDO /X1 ---
  if (commandName === 'x1') {
    await interaction.deferReply();

    try {
      const adv = interaction.options.getUser('adversario');
      const sheetPartidas = await getSheet('Partidas');
      const rows = await sheetPartidas.getRows();

      let juntos = 0;
      let contra = 0;
      let vitoriasUser = 0;
      let vitoriasAdv = 0;

      rows.forEach(r => {
        const timeA = (r.get('team_a_ids') || '').split(',').map(s => s.trim());
        const timeB = (r.get('team_b_ids') || '').split(',').map(s => s.trim());
        const vencedor = r.get('team_winner') || '';

        const userEmA = timeA.includes(interaction.user.id);
        const userEmB = timeB.includes(interaction.user.id);
        const advEmA = timeA.includes(adv.id);
        const advEmB = timeB.includes(adv.id);

        if ((userEmA && advEmA) || (userEmB && advEmB)) {
          juntos++;
        } else if ((userEmA && advEmB) || (userEmB && advEmA)) {
          contra++;
          if (userEmA && vencedor.includes('A')) vitoriasUser++;
          else if (userEmB && vencedor.includes('B')) vitoriasUser++;
          else if (advEmA && vencedor.includes('A')) vitoriasAdv++;
          else if (advEmB && vencedor.includes('B')) vitoriasAdv++;
        }
      });

      const embed = new EmbedBuilder()
        .setTitle(`⚔️ Confronto Direto (Head-to-Head)`)
        .setColor(0xE74C3C)
        .setDescription(`**${interaction.user.username}** VS **${adv.username}**`)
        .addFields(
          { name: '🤝 Partidas no Mesmo Time', value: `${juntos}`, inline: true },
          { name: '⚔️ Partidas como Adversários', value: `${contra}`, inline: true },
          { name: '🏆 Placar de Vitórias (Contras)', value: `**${interaction.user.username}** \`${vitoriasUser}\` x \`${vitoriasAdv}\` **${adv.username}**`, inline: false }
        )
        .setTimestamp();

      return await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      console.error('Erro no /x1:', err);
      return await interaction.editReply('⚠️ Erro ao calcular confronto direto.');
    }
  }

  // --- COMANDO /MOVER-TIMES [ADM] ---
  if (commandName === 'mover-times') {
    if (!(await ehAdministrador(interaction))) {
      return await interaction.reply({ 
        content: '❌ Apenas membros com o cargo **ADM** ou **Founder** podem mover membros!', 
        ephemeral: true 
      });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const canalA = interaction.options.getChannel('canal_time_a');
      const canalB = interaction.options.getChannel('canal_time_b');

      if (!interaction.member.voice.channel) {
        return await interaction.editReply('❌ Você precisa estar em um canal de voz para mover os jogadores.');
      }

      const membrosNaVoz = Array.from(interaction.member.voice.channel.members.values());

      let movidosA = 0;
      let movidosB = 0;

      for (let i = 0; i < membrosNaVoz.length; i++) {
        if (i % 2 === 0) {
          await membrosNaVoz[i].voice.setChannel(canalA);
          movidosA++;
        } else {
          await membrosNaVoz[i].voice.setChannel(canalB);
          movidosB++;
        }
      }

      return await interaction.editReply(`✅ **Jogadores movidos!**\n• **${canalA.name}:** ${movidosA} jogadores\n• **${canalB.name}:** ${movidosB} jogadores`);
    } catch (err) {
      console.error('Erro no /mover-times:', err);
      return await interaction.editReply('❌ Erro ao mover membros. Verifique se o Bot tem a permissão "Mover Membros".');
    }
  }

  // --- COMANDO /REUNIR [ADM] ---
  if (commandName === 'reunir') {
    if (!(await ehAdministrador(interaction))) {
      return await interaction.reply({ 
        content: '❌ Apenas membros com o cargo **ADM** ou **Founder** podem usar este comando!', 
        ephemeral: true 
      });
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const canalLobby = interaction.options.getChannel('canal_lobby');
      const guild = interaction.guild;

      let reunidos = 0;
      const voiceChannels = guild.channels.cache.filter(c => c.isVoiceBased());

      for (const [id, channel] of voiceChannels) {
        if (channel.id !== canalLobby.id) {
          for (const [mId, member] of channel.members.values()) {
            await member.voice.setChannel(canalLobby);
            reunidos++;
          }
        }
      }

      return await interaction.editReply(`✅ **${reunidos} jogadores reunidos** no canal **${canalLobby.name}**!`);
    } catch (err) {
      console.error('Erro no /reunir:', err);
      return await interaction.editReply('❌ Erro ao reunir jogadores.');
    }
  }

  // --- COMANDOS DIVERSOS ---
  if (commandName === 'sortear') {
    const voiceChannel = interaction.member.voice.channel;

    if (!voiceChannel) {
      return interaction.reply({
        content: '❌ Você precisa estar em um canal de voz para usar este comando!',
        ephemeral: true,
      });
    }

    const members = Array.from(voiceChannel.members.values()).filter(m => !m.user.bot);

    if (members.length < 2) {
      return interaction.reply({
        content: '❌ É necessário ter pelo menos 2 pessoas na sala de voz para sortear.',
        ephemeral: true,
      });
    }

    function parseRank(displayName) {
      const normalized = displayName.normalize('NFKD');
      const rankMap = [
        { key: 'SS', weight: 7 },
        { key: 'S',  weight: 6 },
        { key: 'A',  weight: 5 },
        { key: 'B',  weight: 4 },
        { key: 'C',  weight: 3 },
        { key: 'D',  weight: 2 },
        { key: 'E',  weight: 1 },
      ];

      for (const rank of rankMap) {
        const regex = new RegExp(`(?:^|[\\s|❘|/|\\-])${rank.key}(?:[\\s|❘|/|\\-]|$|\\b)`, 'i');
        if (regex.test(normalized)) {
          return { rank: rank.key, weight: rank.weight };
        }
      }
      return { rank: 'Sem Rank', weight: 3 };
    }

    const players = members.map(m => {
      const rankInfo = parseRank(m.displayName);
      return {
        name: m.displayName,
        weight: rankInfo.weight,
        rank: rankInfo.rank
      };
    });

    players.sort((a, b) => b.weight - a.weight || (Math.random() - 0.5));

    const timeA = [];
    const timeB = [];
    let pontosA = 0;
    let pontosB = 0;

    players.forEach(p => {
      if (pontosA <= pontosB && timeA.length < Math.ceil(players.length / 2)) {
        timeA.push(p);
        pontosA += p.weight;
      } else if (timeB.length < Math.ceil(players.length / 2)) {
        timeB.push(p);
        pontosB += p.weight;
      } else {
        timeA.push(p);
        pontosA += p.weight;
      }
    });

    const formatTeam = (team) => team.map(p => `• **${p.name}** \`[Rank ${p.rank} - ${p.weight} pts]\``).join('\n');

    const embedSorteio = new EmbedBuilder()
      .setTitle('🎲 Sorteio Balanceado de Times (CS2)')
      .setColor(0x3498DB)
      .addFields(
        { name: `🔵 TIME A (CT) — Total: ${pontosA} pts`, value: formatTeam(timeA) || 'Nenhum jogador', inline: false },
        { name: `🟡 TIME B (TR) — Total: ${pontosB} pts`, value: formatTeam(timeB) || 'Nenhum jogador', inline: false }
      )
      .setFooter({ text: `Diferença de equilíbrio: ${Math.abs(pontosA - pontosB)} pts` })
      .setTimestamp();

    await interaction.reply({ embeds: [embedSorteio] });
  }

  if (commandName === 'registrar') {
    await interaction.deferReply({ ephemeral: true });

    const rawSteamInput = interaction.options.getString('steamid').trim();
    const discordId = interaction.user.id;
    const nickDiscord = interaction.member ? interaction.member.displayName : interaction.user.username;

    let steamId64 = rawSteamInput;
    const match = rawSteamInput.match(/\d{17}/);
    if (match) steamId64 = match[0];

    if (!/^\d{17}$/.test(steamId64)) {
      return interaction.editReply({
        content: '❌ **SteamID64 inválido!** Insira o número de 17 dígitos (ex: `76561198012345678`) ou o link do perfil.'
      });
    }

    try {
      const sheet = await getSheet('Jogadores');
      const rows = await sheet.getRows();

      const existingRow = rows.find(r => r.get('discord_id') === discordId);

      if (existingRow) {
        existingRow.set('steamid64', steamId64);
        existingRow.set('discord_nick', nickDiscord);
        await existingRow.save();

        await interaction.editReply({
          content: `✅ **SteamID atualizado com sucesso!** Todos os comandos do bot foram liberados.\n\n• **Jogador:** ${nickDiscord}\n• **SteamID64:** \`${steamId64}\``
        });
      } else {
        await sheet.addRow({
          'discord_id': discordId,
          'discord_nick': nickDiscord,
          'steamid64': steamId64,
          'rank_trupe': 'C',
          'elo': '1000',
          'matchs': '0',
          'wins': '0',
          'kills': '0',
          'deaths': '0',
          'assists': '0',
          'head_shot_kills': '0',
          'damage': '0',
          'kast': '0',
          'Advertências': '0'
        });

        await interaction.editReply({
          content: `🎉 **Cadastro realizado com sucesso!** Todos os comandos do bot foram liberados.\n\n• **Jogador:** ${nickDiscord}\n• **SteamID64:** \`${steamId64}\``
        });
      }
    } catch (error) {
      console.error('Erro ao registrar:', error);
      await interaction.editReply({
        content: '⚠️ Erro ao salvar na planilha. Verifique as permissões da Service Account.'
      });
    }
  }

  if (commandName === 'player') {
    await interaction.deferReply();

    const targetUser = interaction.options.getUser('usuario') || interaction.user;
    const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    const displayName = targetMember ? targetMember.displayName : targetUser.username;

    try {
      const sheet = await getSheet('Jogadores');
      const rows = await sheet.getRows();

      const playerRow = rows.find(r => r.get('discord_id') === targetUser.id);

      if (!playerRow) {
        return interaction.editReply({
          content: `❌ O jogador **${displayName}** ainda não realizou o cadastro via \`/registrar\`.`
        });
      }

      const partidas = parseInt(playerRow.get('matchs') || 0);
      const vitorias = parseInt(playerRow.get('wins') || 0);
      const kills = parseInt(playerRow.get('kills') || 0);
      const deaths = parseInt(playerRow.get('deaths') || 0);
      const hs = parseInt(playerRow.get('head_shot_kills') || 0);
      const elo = playerRow.get('elo') || '1000';

      const kd = deaths > 0 ? (kills / deaths).toFixed(2) : kills.toFixed(2);
      const hsPercent = kills > 0 ? ((hs / kills) * 100).toFixed(0) + '%' : '0%';
      const winrate = partidas > 0 ? ((vitorias / partidas) * 100).toFixed(0) + '%' : '0%';

      const embedPlayer = new EmbedBuilder()
        .setTitle(`📊 Perfil de ${displayName}`)
        .setColor(0x00FF7F)
        .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
        .addFields(
          { name: '🎖️ MMR / Elo', value: `**${elo}** pts`, inline: true },
          { name: '🎮 Partidas', value: `${partidas}`, inline: true },
          { name: '🏆 Vitórias', value: `${vitorias} (${winrate})`, inline: true },
          { name: '⚔️ K/D Ratio', value: `${kd}`, inline: true },
          { name: '🎯 Headshots %', value: `${hsPercent}`, inline: true },
          { name: '🔫 Kills / Deaths', value: `${kills} / ${deaths}`, inline: true },
          { name: '⚠️ Advertências', value: `${playerRow.get('Advertências') || 0}`, inline: true },
          { name: '🆔 SteamID64', value: `\`${playerRow.get('steamid64') || 'Não informado'}\``, inline: false }
        )
        .setFooter({ text: 'Mix Trupe • Estatísticas do Servidor' })
        .setTimestamp();

      await interaction.editReply({ embeds: [embedPlayer] });

    } catch (error) {
      console.error('Erro ao buscar player:', error);
      await interaction.editReply({ content: '⚠️ Erro ao consultar a planilha de dados.' });
    }
  }

  if (commandName === 'ranking') {
    await interaction.deferReply();

    try {
      const sheet = await getSheet('Jogadores');
      const rows = await sheet.getRows();

      if (rows.length === 0) {
        return interaction.editReply({ content: '📋 Nenhum jogador cadastrado na planilha ainda.' });
      }

      const rankedPlayers = rows.map(r => ({
        nick: r.get('discord_nick') || 'Jogador Desconhecido',
        vitorias: parseInt(r.get('wins') || 0),
        partidas: parseInt(r.get('matchs') || 0),
        elo: parseInt(r.get('elo') || 1000),
        kills: parseInt(r.get('kills') || 0),
        deaths: parseInt(r.get('deaths') || 0),
      })).sort((a, b) => b.elo - a.elo || b.vitorias - a.vitorias);

      const top10 = rankedPlayers.slice(0, 10);

      const medals = ['🥇', '🥈', '🥉'];
      let leaderboardText = '';

      top10.forEach((p, index) => {
        const medal = medals[index] || `\`#${index + 1}\``;
        leaderboardText += `${medal} **${p.nick}** — **${p.elo} Elo** *(${p.vitorias}V | ${p.partidas}P)*\n`;
      });

      const embedRanking = new EmbedBuilder()
        .setTitle('🏆 Top 10 Leaderboard (Elo) — Mix Trupe')
        .setColor(0xF1C40F)
        .setDescription(leaderboardText || 'Nenhum dado para exibir.')
        .setFooter({ text: 'Ordenado por Pontuação de Elo' })
        .setTimestamp();

      await interaction.editReply({ embeds: [embedRanking] });

    } catch (error) {
      console.error('Erro no /ranking:', error);
      await interaction.editReply({ content: '⚠️ Erro ao gerar o ranking do servidor.' });
    }
  }

  if (commandName === 'stats-mapa') {
    await interaction.deferReply();

    try {
      const mapaFiltro = interaction.options.getString('mapa');
      const jogadorFiltro = interaction.options.getUser('jogador');

      const sheetStats = await getSheet('Stats_Partidas');
      const sheetPartidas = await getSheet('Partidas');
      
      const rowsStats = await sheetStats.getRows();
      const rowsPartidas = await sheetPartidas.getRows();

      if (!mapaFiltro && !jogadorFiltro) {
        const mapaContagem = {};
        rowsPartidas.forEach(row => {
          const m = row.get('map') || 'Desconhecido';
          mapaContagem[m] = (mapaContagem[m] || 0) + 1;
        });

        const mapasOrdenados = Object.entries(mapaContagem)
          .sort((a, b) => b[1] - a[1])
          .map(([m, qtd], index) => `**${index + 1}. ${m}** — ${qtd} partida(s)`)
          .join('\n') || 'Nenhuma partida registrada.';

        const embed = new EmbedBuilder()
          .setTitle('🗺️ Estatísticas de Mapas da Comunidade')
          .setColor(0x00FF7F)
          .addFields({ name: '🔥 Mapas Mais Jogados', value: mapasOrdenados })
          .setFooter({ text: 'Use /stats-mapa [mapa] para ver o Rei do Mapa!' });

        return await interaction.editReply({ embeds: [embed] });
      }

      if (mapaFiltro && !jogadorFiltro) {
        const partidasDoMapa = rowsPartidas.filter(r => (r.get('map') || '').toLowerCase() === mapaFiltro.toLowerCase());
        const statsDoMapa = rowsStats.filter(r => (r.get('map') || '').toLowerCase() === mapaFiltro.toLowerCase());

        if (partidasDoMapa.length === 0) {
          return await interaction.editReply(`⚠️ Nenhuma partida registrada no mapa **${mapaFiltro}** ainda.`);
        }

        const playerMapStats = {};
        statsDoMapa.forEach(row => {
          const discordId = row.get('discord_id');
          const nick = row.get('nick_discord') || 'Jogador';
          const kills = parseInt(row.get('kills') || 0);
          const deaths = parseInt(row.get('deaths') || 0);

          if (!playerMapStats[discordId]) {
            playerMapStats[discordId] = { nick, kills: 0, deaths: 0, jogos: 0 };
          }

          playerMapStats[discordId].kills += kills;
          playerMapStats[discordId].deaths += deaths;
          playerMapStats[discordId].jogos += 1;
        });

        let reiDoMapa = null;
        let melhorKD = -1;

        Object.values(playerMapStats).forEach(p => {
          const kd = p.deaths === 0 ? p.kills : (p.kills / p.deaths);
          if (kd > melhorKD) {
            melhorKD = kd;
            reiDoMapa = p;
          }
        });

        const embed = new EmbedBuilder()
          .setTitle(`📊 Estatísticas do Mapa: ${mapaFiltro}`)
          .setColor(0xF1C40F)
          .addFields(
            { name: '🎮 Total de Partidas', value: `${partidasDoMapa.length}`, inline: true },
            { 
              name: '👑 Rei do Mapa', 
              value: reiDoMapa ? `**${reiDoMapa.nick}**\nK/D: \`${melhorKD.toFixed(2)}\` (${reiDoMapa.kills}K / ${reiDoMapa.deaths}D em ${reiDoMapa.jogos} partida/s)` : 'Sem dados', 
              inline: false 
            }
          );

        return await interaction.editReply({ embeds: [embed] });
      }

      if (mapaFiltro && jogadorFiltro) {
        const statsJogador = rowsStats.filter(r => 
          r.get('discord_id') === jogadorFiltro.id && 
          (r.get('map') || '').toLowerCase() === mapaFiltro.toLowerCase()
        );

        if (statsJogador.length === 0) {
          return await interaction.editReply(`⚠️ O jogador <@${jogadorFiltro.id}> não possui dados gravados no mapa **${mapaFiltro}**.`);
        }

        let totalKills = 0, totalDeaths = 0, totalAssists = 0, totalDano = 0;
        statsJogador.forEach(r => {
          totalKills += parseInt(r.get('kills') || 0);
          totalDeaths += parseInt(r.get('deaths') || 0);
          totalAssists += parseInt(r.get('assists') || 0);
          totalDano += parseFloat(r.get('damage') || 0);
        });

        const partidasQtd = statsJogador.length;
        const kdRatio = totalDeaths === 0 ? totalKills : (totalKills / totalDeaths).toFixed(2);
        const adrMedio = (totalDano / (partidasQtd * 24)).toFixed(1);

        const embed = new EmbedBuilder()
          .setTitle(`🎯 ${jogadorFiltro.username} no mapa ${mapaFiltro}`)
          .setColor(0x3498DB)
          .addFields(
            { name: 'Partidas', value: `${partidasQtd}`, inline: true },
            { name: 'K / D / A', value: `${totalKills} / ${totalDeaths} / ${totalAssists}`, inline: true },
            { name: 'K/D Ratio', value: `${kdRatio}`, inline: true },
            { name: 'ADR Médio', value: `${adrMedio}`, inline: true }
          );

        return await interaction.editReply({ embeds: [embed] });
      }
    } catch (error) {
      console.error('Erro no /stats-mapa:', error);
      await interaction.editReply('⚠️ Erro ao consultar as estatísticas por mapa.');
    }
  }

  if (commandName === 'partida-info') {
    await interaction.deferReply();

    try {
      const idBuscado = interaction.options.getString('id');
      const sheetPartidas = await getSheet('Partidas');
      const rowsPartidas = await sheetPartidas.getRows();

      if (rowsPartidas.length === 0) {
        return await interaction.editReply('⚠️ Nenhuma partida encontrada no sistema.');
      }

      let partida;
      if (idBuscado) {
        partida = rowsPartidas.find(r => r.get('matchid') === idBuscado);
      } else {
        partida = rowsPartidas[rowsPartidas.length - 1];
      }

      if (!partida) {
        return await interaction.editReply(`❌ Partida ID \`#${idBuscado}\` não foi encontrada.`);
      }

      const idsA = (partida.get('team_a_ids') || '').split(',').filter(Boolean).map(id => `<@${id.trim()}>`).join('\n');
      const idsB = (partida.get('team_b_ids') || '').split(',').filter(Boolean).map(id => `<@${id.trim()}>`).join('\n');

      const embed = new EmbedBuilder()
        .setTitle(`📌 Detalhes da Partida #${partida.get('matchid')}`)
        .setColor(0x9B59B6)
        .addFields(
          { name: '📅 Data/Hora', value: partida.get('date') || 'N/I', inline: true },
          { name: '🗺️ Mapa', value: partida.get('map') || 'N/I', inline: true },
          { name: '🏆 Time Vencedor', value: partida.get('team_winner') || 'N/I', inline: true },
          { name: `🔵 Time A (${partida.get('score_a') || 0})`, value: idsA || 'Sem jogadores', inline: true },
          { name: `🟡 Time B (${partida.get('score_b') || 0})`, value: idsB || 'Sem jogadores', inline: true },
          { name: '⭐ MVP', value: partida.get('mvp') || 'N/A', inline: false },
          { name: '🔗 Link Demos/Stats', value: partida.get('link_demo_and_stats') || 'Não informado', inline: false }
        );

      return await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Erro no /partida-info:', error);
      await interaction.editReply('⚠️ Erro ao consultar os dados da partida.');
    }
  }

  // --- COMANDOS DE MODERAÇÃO & ADVERTÊNCIAS [ADM] ---
  if (commandName === 'advertir' || commandName === 'ausente') {
    if (!(await ehAdministrador(interaction))) {
      return await interaction.reply({ 
        content: '❌ Apenas membros com o cargo **ADM** ou **Founder** podem aplicar advertências!', 
        ephemeral: true 
      });
    }

    await interaction.deferReply();

    try {
      const targetUser = interaction.options.getUser('jogador');
      const motivo = commandName === 'ausente' 
        ? 'Ausência / WO após dar ready na fila' 
        : (interaction.options.getString('motivo') || 'Comportamento Inadequado / Ragequit');

      const sheetJogadores = await getSheet('Jogadores');
      const rowsJogadores = await sheetJogadores.getRows();

      let rowJogador = rowsJogadores.find(r => r.get('discord_id') === targetUser.id);

      let advAtuais = 0;

      if (rowJogador) {
        advAtuais = parseInt(rowJogador.get('Advertências') || 0) + 1;
        rowJogador.set('Advertências', advAtuais.toString());
        await rowJogador.save();
      } else {
        advAtuais = 1;
        await sheetJogadores.addRow({
          'discord_id': targetUser.id,
          'discord_nick': targetUser.username,
          'Advertências': '1',
          'elo': '1000'
        });
      }

      const bloqueado = advAtuais >= MAX_ADVERTENCIAS;

      const embed = new EmbedBuilder()
        .setTitle(`⚖️ Punição Registrada — ${targetUser.username}`)
        .setColor(bloqueado ? 0xFF0000 : 0xE67E22)
        .addFields(
          { name: '👤 Jogador', value: `<@${targetUser.id}>`, inline: true },
          { name: '⚠️ Advertências Totais', value: `**${advAtuais}** / ${MAX_ADVERTENCIAS}`, inline: true },
          { name: '📝 Motivo', value: motivo, inline: false },
          { 
            name: '🚫 Status na Fila', 
            value: bloqueado 
              ? '❌ **BLOQUEADO!** O jogador atingiu o limite e não pode entrar na fila.' 
              : '⚠️ **Atenção:** O jogador ainda pode jogar, mas está próximo do limite.', 
            inline: false 
          }
        )
        .setTimestamp();

      return await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Erro ao advertir:', error);
      await interaction.editReply('⚠️ Erro ao registrar a advertência na planilha.');
    }
  }

  if (commandName === 'desadvertir') {
    if (!(await ehAdministrador(interaction))) {
      return await interaction.reply({ 
        content: '❌ Apenas membros com o cargo **ADM** ou **Founder** podem remover advertências!', 
        ephemeral: true 
      });
    }

    await interaction.deferReply();

    try {
      const targetUser = interaction.options.getUser('jogador');
      const sheetJogadores = await getSheet('Jogadores');
      const rowsJogadores = await sheetJogadores.getRows();

      let rowJogador = rowsJogadores.find(r => r.get('discord_id') === targetUser.id);

      if (!rowJogador || parseInt(rowJogador.get('Advertências') || 0) <= 0) {
        return await interaction.editReply(`✅ O jogador <@${targetUser.id}> não possui nenhuma advertência ativa.`);
      }

      let advAtuais = Math.max(0, parseInt(rowJogador.get('Advertências') || 0) - 1);
      rowJogador.set('Advertências', advAtuais.toString());
      await rowJogador.save();

      const embed = new EmbedBuilder()
        .setTitle(`✅ Advertência Removida — ${targetUser.username}`)
        .setColor(0x2ECC71)
        .addFields(
          { name: '👤 Jogador', value: `<@${targetUser.id}>`, inline: true },
          { name: '⚠️ Advertências Restantes', value: `**${advAtuais}** / ${MAX_ADVERTENCIAS}`, inline: true }
        );

      return await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Erro ao desadvertir:', error);
      await interaction.editReply('⚠️ Erro ao atualizar advertências.');
    }
  }

  if (commandName === 'conectar' || commandName === 'server') {
    const embedServers = new EmbedBuilder()
      .setTitle('🎮 SERVIDORES DA TRUPE (CS2)')
      .setColor(0x3498DB)
      .setDescription(
        '• **CONECTE NO SERVIDOR**\n' +
        '• **COLE O IP COMPLETO NO CONSOLE DO GAME**\n' +
        '• **OBRIGATÓRIO USAR O IP COMPLETO PARA ENTRAR**'
      )
      .addFields(
        { name: '🖥️ SERVIDOR 01', value: '```\nconnect 103.14.27.41:27001; password 000009\n```', inline: false },
        { name: '🖥️ SERVIDOR 02', value: '```\nconnect 103.14.27.41:27002; password 000009\n```', inline: false },
        { name: '🖥️ SERVIDOR 03', value: '```\nconnect 103.14.27.41:27003; password 605946\n```', inline: false },
        { name: '🖥️ SERVIDOR 04', value: '```\nconnect 103.14.27.41:27004; password 860913\n```', inline: false }
      )
      .setFooter({ text: 'Copie a linha do servidor desejado e cole no console do CS2' })
      .setTimestamp();

    await interaction.reply({ embeds: [embedServers] });
  }

  if (commandName === 'pick') {
    const modo = interaction.options.getString('modo');
    const capA = interaction.options.getUser('capitao_a') || interaction.user;
    const capB = interaction.options.getUser('capitao_b');

    if (!capB) {
      return interaction.reply({
        content: '❌ Você precisa especificar o **Capitão do Time B** (`capitao_b`) para iniciar o veto!',
        ephemeral: true
      });
    }

    if (capA.id === capB.id) {
      return interaction.reply({
        content: '❌ O Capitão A e o Capitão B não podem ser a mesma pessoa!',
        ephemeral: true
      });
    }

    let mapPool = [
      'De_dust2',
      'De_mirage',
      'De_nuke',
      'De_ancient',
      'De_cache',
      'De_anubis',
      'De_inferno'
    ];

    const passosMD1 = [
      { acao: 'BAN', team: capA, teamName: 'Time A' },
      { acao: 'BAN', team: capB, teamName: 'Time B' },
      { acao: 'BAN', team: capA, teamName: 'Time A' },
      { acao: 'BAN', team: capB, teamName: 'Time B' },
      { acao: 'BAN', team: capA, teamName: 'Time A' },
      { acao: 'BAN', team: capB, teamName: 'Time B' },
    ];

    const passosMD3 = [
      { acao: 'BAN', team: capA, teamName: 'Time A' },
      { acao: 'BAN', team: capB, teamName: 'Time B' },
      { acao: 'PICK', team: capA, teamName: 'Time A', sideTeam: capB, sideTeamName: 'Time B' },
      { acao: 'PICK', team: capB, teamName: 'Time B', sideTeam: capA, sideTeamName: 'Time A' },
      { acao: 'BAN', team: capA, teamName: 'Time A' },
      { acao: 'BAN', team: capB, teamName: 'Time B' },
    ];

    const passos = modo === 'MD1' ? passosMD1 : passosMD3;
    let passoAtual = 0;

    let aguardandoEscolhaLado = false;
    let mapaPickadoPendente = null;
    let timeEscolhendoLadoPendente = null;

    const bans = [];
    const picks = [];
    let decider = null;

    function renderMapButtons(mapasDisponiveis, disabled = false) {
      const rows = [];
      let currentRow = new ActionRowBuilder();

      mapasDisponiveis.forEach((map, index) => {
        if (index > 0 && index % 5 === 0) {
          rows.push(currentRow);
          currentRow = new ActionRowBuilder();
        }

        currentRow.addComponents(
          new ButtonBuilder()
            .setCustomId(`veto_${map}`)
            .setLabel(map)
            .setStyle(ButtonStyle.Primary)
            .setDisabled(disabled)
        );
      });

      if (currentRow.components.length > 0) {
        rows.push(currentRow);
      }

      return rows;
    }

    function renderSideButtons() {
      return [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('side_CT')
            .setLabel('🛡️ Começar de CT')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId('side_TR')
            .setLabel('⚔️ Começar de TR')
            .setStyle(ButtonStyle.Danger)
        )
      ];
    }

    function buildVetoEmbed() {
      let statusTexto = '';

      if (aguardandoEscolhaLado) {
        statusTexto = `🎯 **${mapaPickadoPendente.mapa}** escolhido por **${mapaPickadoPendente.teamName}**!\nVez de <@${timeEscolhendoLadoPendente.id}> escolher o lado (**CT** ou **TR**).`;
      } else {
        const step = passos[passoAtual];
        if (step) {
          const acaoTexto = step.acao === 'BAN' ? '❌ **BANIR**' : '✅ **ESCOLHER (PICK)**';
          statusTexto = `Vez de <@${step.team.id}> (${step.teamName}) para ${acaoTexto} um mapa!`;
        } else {
          statusTexto = '🎉 **Processo de Veto Concluído!**';
        }
      }

      let historicoBans = bans.map(b => `• ❌ ~${b.mapa}~ *(por ${b.teamName})*`).join('\n') || 'Nenhum mapa banido ainda.';
      let historicoPicks = picks.map(p => `• ✅ **${p.mapa}** *(Pick ${p.teamName})* — Lado do ${p.sideTeamName}: **${p.lado}**`).join('\n') || 'Nenhum mapa escolhido ainda.';

      const embed = new EmbedBuilder()
        .setTitle(`🗺️ Veto de Mapas (${modo}) — Mix Trupe`)
        .setColor(aguardandoEscolhaLado ? 0xF39C12 : (passos[passoAtual] ? (passos[passoAtual].acao === 'BAN' ? 0xE74C3C : 0x2ECC71) : 0xF1C40F))
        .setDescription(`🔵 **Time A (Capitão):** <@${capA.id}>\n🟡 **Time B (Capitão):** <@${capB.id}>\n\n📢 **Status Atual:**\n${statusTexto}`)
        .addFields(
          { name: '🚫 Mapas Banidos', value: historicoBans, inline: false },
          { name: '🎯 Mapas Escolhidos', value: modo === 'MD3' ? historicoPicks : (picks.length ? `• ✅ **${picks[0].mapa}**` : 'Nenhum'), inline: false },
          { name: '⚔️ Decider (Decisão no Faca)', value: decider ? `• 🗡️ **${decider}**` : 'Aguardando definição...', inline: false }
        )
        .setFooter({ text: 'Apenas os capitães podem interagir nas suas respectivas vezes.' })
        .setTimestamp();

      return embed;
    }

    const replyMessage = await interaction.reply({
      embeds: [buildVetoEmbed()],
      components: renderMapButtons(mapPool),
      fetchReply: true
    });

    const collector = replyMessage.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: 600000
    });

    collector.on('collect', async i => {
      if (aguardandoEscolhaLado) {
        if (i.user.id !== timeEscolhendoLadoPendente.id) {
          return i.reply({
            content: `❌ Apenas <@${timeEscolhendoLadoPendente.id}> pode escolher o lado para este mapa!`,
            ephemeral: true
          });
        }

        const ladoEscolhido = i.customId === 'side_CT' ? 'CT 🛡️' : 'TR ⚔️';
        
        picks.push({
          mapa: mapaPickadoPendente.mapa,
          teamName: mapaPickadoPendente.teamName,
          sideTeamName: mapaPickadoPendente.sideTeamName,
          lado: ladoEscolhido
        });

        aguardandoEscolhaLado = false;
        mapaPickadoPendente = null;
        timeEscolhendoLadoPendente = null;
        passoAtual++;

        if (passoAtual >= passos.length) {
          decider = mapPool[0];
          await i.update({
            embeds: [buildVetoEmbed()],
            components: renderMapButtons(mapPool, true)
          });
          return collector.stop('CONCLUIDO');
        } else {
          return await i.update({
            embeds: [buildVetoEmbed()],
            components: renderMapButtons(mapPool)
          });
        }
      }

      const stepAtual = passos[passoAtual];

      if (i.user.id !== stepAtual.team.id) {
        return i.reply({
          content: `❌ Apenas o capitão da vez (<@${stepAtual.team.id}>) pode realizar esta ação!`,
          ephemeral: true
        });
      }

      const selectedMap = i.customId.replace('veto_', '');
      mapPool = mapPool.filter(m => m !== selectedMap);

      if (stepAtual.acao === 'BAN') {
        bans.push({ mapa: selectedMap, teamName: stepAtual.teamName });
        passoAtual++;

        if (passoAtual >= passos.length) {
          decider = mapPool[0];
          if (modo === 'MD1') {
            picks.push({ mapa: decider, teamName: 'Decider', sideTeamName: 'Ambos', lado: 'Decisão no Faca 🗡️' });
          }

          await i.update({
            embeds: [buildVetoEmbed()],
            components: renderMapButtons(mapPool, true)
          });
          collector.stop('CONCLUIDO');
        } else {
          await i.update({
            embeds: [buildVetoEmbed()],
            components: renderMapButtons(mapPool)
          });
        }

      } else if (stepAtual.acao === 'PICK') {
        aguardandoEscolhaLado = true;
        mapaPickadoPendente = { mapa: selectedMap, teamName: stepAtual.teamName, sideTeamName: stepAtual.sideTeamName };
        timeEscolhendoLadoPendente = stepAtual.sideTeam;

        await i.update({
          embeds: [buildVetoEmbed()],
          components: renderSideButtons()
        });
      }
    });

    collector.on('end', async (collected, reason) => {
      if (reason !== 'CONCLUIDO') {
        await interaction.editReply({
          content: '⏳ **Tempo limite de veto esgotado!** Reinicie o comando `/pick`.',
          components: renderMapButtons(mapPool, true)
        });
      }
    });
  }

  if (commandName === 'regras') {
    const embedRegras = new EmbedBuilder()
      .setTitle('📜 Regras e Funcionamento — Mix Trupe CS2')
      .setColor(0xE74C3C)
      .addFields(
        { name: '1. Respeito e Fair Play', value: 'Trate todos com respeito. Atitudes tóxicas, racismo ou ofensas pesadas resultarão em banimento do Mix.' },
        { name: '2. Registro Obrigatório', value: 'Para ter suas estatísticas contabilizadas nas partidas, execute o comando `/registrar` informando seu SteamID64.' },
        { name: '3. Fila Automática', value: 'Use `/fila entrar` para entrar no lobby. Ao atingir o número de vagas, o bot faz o auto-start do jogo.' },
        { name: '4. Presença e Compromisso', value: 'Evite ausências (WO) registrando sua presença pelo comando `/presenca`. Ausências geram advertência!' }
      )
      .setFooter({ text: 'Bom jogo a todos! • Diretoria Mix Trupe' });

    await interaction.reply({ embeds: [embedRegras] });
  }

  // --- COMANDO /MUDAR-NICK [ADM] ---
  if (commandName === 'mudar-nick') {
    if (!(await ehAdministrador(interaction))) {
      return await interaction.reply({ 
        content: '❌ Apenas membros com o cargo **ADM** ou **Founder** podem alterar o nick de outros membros!', 
        ephemeral: true 
      });
    }

    await interaction.deferReply({ ephemeral: true });

    const targetUser = interaction.options.getUser('usuario');
    const newNick = interaction.options.getString('novo_nick');

    try {
      const member = await interaction.guild.members.fetch(targetUser.id);
      
      if (!member) {
        return interaction.editReply({ content: '❌ Membro não encontrado neste servidor.' });
      }

      await member.setNickname(newNick);

      await interaction.editReply({
        content: `✅ Apelido de **${targetUser.username}** alterado com sucesso para **${newNick}**!`
      });

    } catch (error) {
      console.error('Erro ao mudar nick:', error);
      await interaction.editReply({
        content: '❌ Ocorreu um erro ao alterar o apelido. Verifique se o cargo do Bot está **acima** do cargo do membro na hierarquia do Discord.'
      });
    }
  }
});

client.login(process.env.DISCORD_TOKEN);