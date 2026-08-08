require('./config/env');
const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder
} = require('discord.js');

// --- IMPORTAÇÃO DO SERVIÇO DE PARTIDAS (FIREGAMES) ---
const { processarPartidaFiregames } = require('./firegamesService');

// --- GOOGLE SHEETS E PERMISSÕES (compartilhados com os comandos em commands/) ---
const { doc, getSheet } = require('./utils/sheets');
const { ehAdministrador } = require('./utils/permissions');

// --- COMANDOS MIGRADOS DO TRUPE-BOT (Components V2) ---
const commandModules = {
  help: require('./commands/help'),
  lives: require('./commands/lives'),
  anuncio: require('./commands/anuncio'),
  addstreamer: require('./commands/addstreamer'),
  removerstreamer: require('./commands/removerstreamer'),
  config: require('./commands/config'),
  clear: require('./commands/clear'),
};

// --- CONFIGURAÇÃO DE CONSTANTES ---
const MAX_ADVERTENCIAS = 3;

// A cada X pontos de advertência acumulados, o jogador recebe 1 punição automática
const PONTOS_POR_PUNICAO = MAX_ADVERTENCIAS;
const DURACAO_BAN_SEMANAL_MS = 7 * 24 * 60 * 60 * 1000; // 1ª punição: 1 semana banido do Mix

// Tipos de advertência disponíveis em /advertir e sua pontuação
const TIPOS_ADVERTENCIA = {
  falta_atraso: { label: 'Falta ou Atraso', pontos: 1 },
  falta_respeito: { label: 'Falta de Respeito com ADM/Staff', pontos: 2 },
  ragequit_troll: { label: 'Ragequit ou Troll', pontos: 3 },
};

// Estado Global da Lista de Presença em Memória (perdido ao reiniciar o bot)
let presencaConfig = {
  aberta: false,
  capacidade: 10,
  jogadores: [], // { id, name, timestamp }
  canalId: null,
  mensagemId: null,
};

// --- FUNÇÃO AUXILIAR: VERIFICA SE O JOGADOR ESTÁ REGISTRADO ---
// Cache dos SteamIDs por discord_id, usado pela trava de segurança abaixo (roda em praticamente
// todo comando, antes de qualquer resposta à interação). Sem esse cache, cada interação dispara
// sua própria consulta ao Google Sheets — sob uma rajada de uso simultâneo (ex: vários jogadores
// confirmando /presenca ao mesmo tempo), essas consultas concorrentes podem ultrapassar os 3s que
// o Discord dá pra reconhecer a interação, derrubando-a com "Unknown interaction".
const REGISTRO_CACHE_TTL_MS = 30 * 1000;
let registroCache = { steamIdsPorDiscordId: null, timestamp: 0, carregando: null };

async function carregarRegistroCache() {
  try {
    const sheet = await getSheet('Jogadores');
    const rows = await sheet.getRows();
    const mapa = new Map();
    for (const row of rows) {
      mapa.set(row.get('discord_id'), row.get('steamid64'));
    }
    registroCache.steamIdsPorDiscordId = mapa;
    registroCache.timestamp = Date.now();
    return mapa;
  } finally {
    registroCache.carregando = null;
  }
}

// Chame depois de gravar um novo cadastro (/registrar), pra não deixar a pessoa "não registrada"
// aos olhos do bot por até REGISTRO_CACHE_TTL_MS depois de se cadastrar.
function invalidarRegistroCache() {
  registroCache.timestamp = 0;
}

async function jogadorEstaRegistrado(discordId) {
  try {
    const cacheValido = registroCache.steamIdsPorDiscordId && (Date.now() - registroCache.timestamp) < REGISTRO_CACHE_TTL_MS;

    let mapa;
    if (cacheValido) {
      mapa = registroCache.steamIdsPorDiscordId;
    } else if (registroCache.carregando) {
      // Já tem uma atualização em andamento (outra interação concorrente disparou) — reaproveita.
      mapa = await registroCache.carregando;
    } else {
      registroCache.carregando = carregarRegistroCache();
      mapa = await registroCache.carregando;
    }

    const steamId = mapa.get(discordId);
    return !!(steamId && steamId !== 'N/A');
  } catch (err) {
    console.error('Erro ao verificar registro do jogador:', err);
    return false;
  }
}

// --- FUNÇÃO AUXILIAR: VERIFICA SE O JOGADOR ESTÁ BLOQUEADO POR PUNIÇÃO ---
async function verificarBloqueioJogador(rowJogador) {
  if (!rowJogador) return { bloqueado: false };

  if ((rowJogador.get('Banido_Temporada') || '').toString().toUpperCase() === 'TRUE') {
    return {
      bloqueado: true,
      motivo: '🚫 **Acesso Negado!** Você está banido do Mix até o fim da temporada atual por acúmulo de advertências.'
    };
  }

  const banidoAte = rowJogador.get('Banido_Até');
  if (banidoAte) {
    const dataBan = new Date(banidoAte);
    if (!isNaN(dataBan.getTime())) {
      if (Date.now() < dataBan.getTime()) {
        return {
          bloqueado: true,
          motivo: `🚫 **Acesso Negado!** Você está banido do Mix até <t:${Math.floor(dataBan.getTime() / 1000)}:F> por acúmulo de advertências.`
        };
      }

      // Ban temporário expirado: libera automaticamente o jogador
      rowJogador.set('Banido_Até', '');
      await rowJogador.save();
    }
  }

  return { bloqueado: false };
}

// --- CLIENTE DISCORD ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
  ],
});

// --- REDE DE SEGURANÇA: um erro não tratado em qualquer lugar (ex: reply numa interação
// já expirada) não pode derrubar o processo inteiro do bot, só deve ser logado. ---
client.on('error', (error) => {
  console.error('Erro no cliente Discord:', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

// --- FUNÇÕES AUXILIARES: PAINEL DE PRESENÇA (mensagem fixa que se auto-atualiza) ---
function construirEmbedPresenca(tituloOverride, corOverride) {
  const listaOrdenada = [...presencaConfig.jogadores].sort((a, b) => a.timestamp - b.timestamp);
  const lista = listaOrdenada
    .map((p, i) => `**${i + 1}.** ${p.name}`)
    .join('\n') || '*Nenhuma presença confirmada ainda.*';

  const statusTitulo = presencaConfig.aberta
    ? `📅 Lista de Presença [${presencaConfig.jogadores.length}/${presencaConfig.capacidade}]`
    : `🔒 Lista de Presença Encerrada [${presencaConfig.jogadores.length}/${presencaConfig.capacidade}]`;

  return new EmbedBuilder()
    .setTitle(tituloOverride || statusTitulo)
    .setColor(corOverride || (presencaConfig.aberta ? 0xF1C40F : 0x95A5A6))
    .setDescription(lista)
    .setFooter({
      text: presencaConfig.aberta
        ? 'Use /presenca confirmar para garantir sua vaga! A ordem é de quem confirmou primeiro.'
        : 'Lista encerrada. Peça a um ADM/Directors para abrir uma nova com /presenca criar.'
    })
    .setTimestamp();
}

async function atualizarPainelPresenca() {
  if (!presencaConfig.canalId || !presencaConfig.mensagemId) return false;

  try {
    const canal = await client.channels.fetch(presencaConfig.canalId).catch(() => null);
    if (!canal) return false;

    const mensagem = await canal.messages.fetch(presencaConfig.mensagemId).catch(() => null);
    if (!mensagem) return false;

    await mensagem.edit({ embeds: [construirEmbedPresenca()] });
    return true;
  } catch (err) {
    console.error('Erro ao atualizar painel de presença:', err);
    return false;
  }
}

// --- REGISTRO DE COMANDOS ---
// O registro em si (rest.put de Routes.applicationGuildCommands) saiu daqui e foi
// pro deploy-commands.js (rodado manualmente com `npm run deploy`) — não é necessário
// nem desejável conectar todo o Client ao gateway pra isso, e assim os comandos não
// somem/ressincronizam a cada boot. Ver docs/plans/modularizacao-index-js.md §2 e §7.
client.once('clientReady', () => {
  console.log(`🤖 Bot online como ${client.user.tag}!`);
});

// --- EXECUÇÃO DAS INTERAÇÕES ---
client.on('interactionCreate', async (interaction) => {

  // ==========================================
  // 0. PROCESSAMENTO DE MENUS DE SELEÇÃO (SELECT MENU)
  // ==========================================
  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === 'select_regras') {
      const opcao = interaction.values[0];

      let embedCategoria = new EmbedBuilder().setTimestamp();

      if (opcao === 'regras_conduta') {
        embedCategoria
          .setTitle('⚖️ Regras de Conduta e Punições')
          .setColor(0xE74C3C)
          .addFields(
            { name: '1. Respeito em Primeiro Lugar', value: 'Proibido qualquer tipo de ofensas pesadas, discriminação, racismo, homofobia ou toxicidade extrema no chat de voz ou texto.' },
            { name: '2. Ausências e WO', value: 'Não comparecer após confirmar presença acarretará em advertência automática via `/ausente` (1 ponto).' },
            { name: '3. Pontos e Punições', value: `Advertências valem **1 a 3 pontos**, de acordo com o tipo. A cada **${PONTOS_POR_PUNICAO} pontos** acumulados o jogador recebe 1 punição automática: a **1ª** bloqueia o \`/presenca confirmar\` por **1 semana**; a **2ª** bane o jogador do Mix até o **fim da temporada atual**.` }
          );
      } else if (opcao === 'regras_filas') {
        embedCategoria
          .setTitle('🎮 Funcionamento da Presença e Servidores')
          .setColor(0x3498DB)
          .addFields(
            { name: '1. Confirmação de Presença', value: 'Apenas jogadores cadastrados via `/registrar` podem confirmar presença com `/presenca confirmar`.' },
            { name: '2. Fechamento da Lista', value: 'Assim que a lista de presença atinge o número de vagas definido em `/presenca criar`, o bot notifica todos e os capitães iniciam a fase de veto com `/pick`.' },
            { name: '3. Conexão Direta', value: 'Utilize o comando `connect` exibido em `/conectar` (ou `/server`) para entrar no servidor do CS2.' }
          );
      } else if (opcao === 'regras_elo') {
        embedCategoria
          .setTitle('🏆 Sistema de Elo e Estatísticas')
          .setColor(0xF1C40F)
          .addFields(
            { name: '1. Pontuação Base', value: 'Todos os jogadores começam com **1000 de Elo** base no cadastro.' },
            { name: '2. Vitórias e Derrotas', value: 'Vitórias concedem em média **+25 Elo** e derrotas removem em média **-20 Elo**.' },
            { name: '3. Bônus de Performance (ADR)', value: 'Jogadores com ADR alto (>100) recebem bônus extra de Elo na partida (+5 pts).' }
          );
      }

      return await interaction.reply({ embeds: [embedCategoria], ephemeral: true });
    }
  }

  // ==========================================
  // 1. PROCESSAMENTO DE FORMULÁRIOS (MODALS)
  // ==========================================
  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith('modal_registrar_')) {
      await interaction.deferReply({ ephemeral: true });

      const rawSteamInput = interaction.fields.getTextInputValue('input_steam').trim();
      const rawFaceitInput = interaction.fields.getTextInputValue('input_faceit').trim();
      const rawGcInput = interaction.fields.getTextInputValue('input_gc').trim();

      const linkFaceit = rawFaceitInput !== '' ? rawFaceitInput : 'N/A';
      const linkGc = rawGcInput !== '' ? rawGcInput : 'N/A';

      const discordId = interaction.customId.replace('modal_registrar_', '');
      const targetMember = discordId === interaction.user.id
        ? interaction.member
        : await interaction.guild.members.fetch(discordId).catch(() => null);
      const nickDiscord = targetMember ? targetMember.displayName : discordId;
      const avatarUrl = targetMember ? targetMember.user.displayAvatarURL({ dynamic: true }) : interaction.user.displayAvatarURL({ dynamic: true });

      let steamid64 = rawSteamInput;
      const match = rawSteamInput.match(/\d{17}/);
      if (match) steamid64 = match[0];

      if (!/^\d{17}$/.test(steamid64)) {
        return interaction.editReply({
          content: '❌ **SteamID64 inválido!** Insira o número de 17 dígitos (ex: `76561198012345678`) ou o link direto do perfil da Steam.'
        });
      }

      try {
        const sheet = await getSheet('Jogadores');
        const rows = await sheet.getRows();

        const existingRow = rows.find(r => r.get('discord_id') === discordId);
        let acaoTexto = '';

        if (existingRow) {
          existingRow.set('steamid64', steamid64);
          existingRow.set('discord_nick', nickDiscord);
          if (linkFaceit !== 'N/A') existingRow.set('link_faceit', linkFaceit);
          if (linkGc !== 'N/A') existingRow.set('link_gc', linkGc);
          await existingRow.save();
          acaoTexto = 'Seus dados foram **atualizados** com sucesso no banco do Mix!';
        } else {
          await sheet.addRow({
            'discord_id': discordId,
            'discord_nick': nickDiscord,
            'steamid64': steamid64,
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
            'Advertências': '0',
            'Punições': '0',
            'Banido_Até': '',
            'Banido_Temporada': '',
            'link_faceit': linkFaceit,
            'link_gc': linkGc
          });
          acaoTexto = `Bem-vindo ao Mix, <@${discordId}>! Seu perfil foi vinculado com sucesso.`;
        }

        invalidarRegistroCache();

        const embedRegistro = new EmbedBuilder()
          .setTitle('🎯 Cadastro Concluído no Mix Trupe!')
          .setColor(0x2ECC71)
          .setDescription(acaoTexto)
          .setThumbnail(avatarUrl)
          .addFields(
            { name: '👤 Jogador', value: `${nickDiscord}`, inline: true },
            { name: '🆔 SteamID64', value: `\`${steamid64}\``, inline: true },
            { name: '🌐 FACEIT', value: linkFaceit, inline: false },
            { name: '🎮 Gamers Club', value: linkGc, inline: false }
          )
          .setFooter({ 
            text: 'Mix Trupe CS2 • Cadastro de Perfil Integrado', 
            iconURL: interaction.guild?.iconURL() || undefined
          })
          .setTimestamp();

        return await interaction.editReply({ embeds: [embedRegistro] });

      } catch (error) {
        console.error('Erro ao registrar via modal:', error);
        return await interaction.editReply({
          content: '⚠️ Erro ao salvar na planilha. Verifique as permissões da Service Account.'
        });
      }
    }

    if (interaction.customId === 'modal_importar_partida') {
      await interaction.deferReply();

      const idPartida = interaction.fields.getTextInputValue('input_id_partida').trim();
      const servidorId = interaction.fields.getTextInputValue('input_servidor_id').trim();
      const mapa = interaction.fields.getTextInputValue('input_mapa').trim();
      const rawScoreA = interaction.fields.getTextInputValue('input_score_a').trim();
      const rawScoreB = interaction.fields.getTextInputValue('input_score_b').trim();

      const scoreA = rawScoreA !== '' ? parseInt(rawScoreA) : 13;
      const scoreB = rawScoreB !== '' ? parseInt(rawScoreB) : 0;

      try {
        await processarPartidaFiregames(idPartida, servidorId, mapa, doc, scoreA, scoreB);
        return await interaction.editReply(`✅ **Partida #${idPartida}** importada com sucesso! Placar registrado: **${scoreA} x ${scoreB}**.`);
      } catch (err) {
        console.error(err);
        return await interaction.editReply(`❌ **Erro ao importar partida:** ${err.message}`);
      }
    }
  }

  // ==========================================
  // 2. PROCESSAMENTO DE SLASH COMMANDS
  // ==========================================
  if (!interaction.isChatInputCommand()) return;

  const { commandName } = interaction;

  // --- COMANDOS MIGRADOS DO TRUPE-BOT (utilitários/ADM, não exigem cadastro de jogador) ---
  if (commandModules[commandName]) {
    // .catch() de defesa: cada comando já trata seus próprios erros internamente,
    // isso aqui é só pra garantir que nenhuma falha inesperada derrube o bot inteiro.
    commandModules[commandName].execute(interaction).catch((error) => {
      console.error(`Erro não tratado no comando /${commandName}:`, error);
    });
    return;
  }

  // --- TRAVA DE SEGURANÇA ---
  const comandosLiberados = ['registrar', 'regras', 'conectar', 'server'];

  if (!comandosLiberados.includes(commandName)) {
    const registrado = await jogadorEstaRegistrado(interaction.user.id);

    if (!registrado) {
      const embedTrava = new EmbedBuilder()
        .setTitle('🔒 Acesso Negado!')
        .setColor(0xE74C3C)
        .setDescription(
          `Olá <@${interaction.user.id}>! Para utilizar qualquer comando do bot e participar do **Mix Trupe**, você precisa vincular o seu **SteamID64** primeiro.\n\n` +
          `👉 Execute o comando abaixo para abrir o formulário de cadastro:\n` +
          `\`\`\`\n/registrar\n\`\`\``
        )
        .setFooter({ text: 'Sistema de Proteção e Estatísticas do Mix Trupe' });

      return await interaction.reply({ embeds: [embedTrava], ephemeral: true });
    }
  }

  // --- COMANDO /REGISTRAR ---
  if (commandName === 'registrar') {
    const usuarioAlvo = interaction.options.getUser('usuario');
    const registrandoOutro = usuarioAlvo && usuarioAlvo.id !== interaction.user.id;

    if (registrandoOutro && !(await ehAdministrador(interaction))) {
      return await interaction.reply({
        content: '❌ Apenas membros com o cargo **Owner** ou **Directors** podem cadastrar outro jogador!',
        ephemeral: true
      });
    }

    const targetId = registrandoOutro ? usuarioAlvo.id : interaction.user.id;

    const modal = new ModalBuilder()
      .setCustomId(`modal_registrar_${targetId}`)
      .setTitle(registrandoOutro ? `Cadastro de Jogador — ${usuarioAlvo.username}` : 'Cadastro de Jogador — Mix Trupe');

    const inputSteam = new TextInputBuilder()
      .setCustomId('input_steam')
      .setLabel('🎮 SteamID64 ou Link do Perfil Steam')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Ex: 76561198012345678 ou steamcommunity.com/id/seu_nick')
      .setMinLength(5)
      .setMaxLength(100)
      .setRequired(true);

    const inputFaceit = new TextInputBuilder()
      .setCustomId('input_faceit')
      .setLabel('🌐 Perfil FACEIT (Opcional)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Ex: faceit.com/pt/players/SeuNick')
      .setMaxLength(100)
      .setRequired(false);

    const inputGc = new TextInputBuilder()
      .setCustomId('input_gc')
      .setLabel('⚡ Perfil Gamers Club (Opcional)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Ex: gamersclub.com.br/player/12345')
      .setMaxLength(100)
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder().addComponents(inputSteam),
      new ActionRowBuilder().addComponents(inputFaceit),
      new ActionRowBuilder().addComponents(inputGc)
    );

    return await interaction.showModal(modal);
  }

  // --- COMANDO /IMPORTAR-PARTIDA ---
  if (commandName === 'importar-partida') {
    if (!(await ehAdministrador(interaction))) {
      return await interaction.reply({ 
        content: '❌ Apenas membros com o cargo **Owner** ou **Directors** podem usar este comando!', 
        ephemeral: true 
      });
    }

    const modal = new ModalBuilder()
      .setCustomId('modal_importar_partida')
      .setTitle('Importar Partida — MatchZy');

    const inputIdPartida = new TextInputBuilder()
      .setCustomId('input_id_partida')
      .setLabel('ID da Partida (MatchZy)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Ex: 55')
      .setRequired(true);

    const inputServidorId = new TextInputBuilder()
      .setCustomId('input_servidor_id')
      .setLabel('ID do Servidor (Opções abaixo)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('• a1b2c3d4 (Serv 1) • 3dc31c75 (Serv 2) • f4d76700 (Serv 3) • 832f29e5 (Serv 4)')
      .setRequired(true);

    const inputMapa = new TextInputBuilder()
      .setCustomId('input_mapa')
      .setLabel('Mapa (Opções abaixo)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('• de_mirage • de_dust2 • de_inferno • de_anubis • de_ancient • de_cache • de_nuke')
      .setRequired(true);

    const inputScoreA = new TextInputBuilder()
      .setCustomId('input_score_a')
      .setLabel('Placar Time A (Opcional - Padrão: 13)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Ex: 13')
      .setRequired(false);

    const inputScoreB = new TextInputBuilder()
      .setCustomId('input_score_b')
      .setLabel('Placar Time B (Opcional - Padrão: 0)')
      .setStyle(TextInputStyle.Short)
      .setPlaceholder('Ex: 9')
      .setRequired(false);

    modal.addComponents(
      new ActionRowBuilder().addComponents(inputIdPartida),
      new ActionRowBuilder().addComponents(inputServidorId),
      new ActionRowBuilder().addComponents(inputMapa),
      new ActionRowBuilder().addComponents(inputScoreA),
      new ActionRowBuilder().addComponents(inputScoreB)
    );

    return await interaction.showModal(modal);
  }

  // --- COMANDO /PLAYER (FORMATO DO 2º PRINT COM BOTÕES DO 3º PRINT) ---
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
      const steamid64 = playerRow.get('steamid64') || '';
      const linkFaceit = playerRow.get('link_faceit') || '';
      const linkGc = playerRow.get('link_gc') || '';

      const kd = deaths > 0 ? (kills / deaths).toFixed(2) : kills.toFixed(2);
      const hsPercent = kills > 0 ? ((hs / kills) * 100).toFixed(0) + '%' : '0%';
      const winrate = partidas > 0 ? ((vitorias / partidas) * 100).toFixed(0) + '%' : '0%';
      const advertencias = playerRow.get('Advertências') || '0';

      const embedPlayer = new EmbedBuilder()
        .setTitle(`📊 Perfil de ${displayName}`)
        .setColor(0x2ECC71)
        .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
        .addFields(
          // Linha 1
          { name: '🎖️ MMR / Elo', value: `**${elo} pts**`, inline: true },
          { name: '🎮 Partidas', value: `${partidas}`, inline: true },
          { name: '🏆 Vitórias', value: `${vitorias} (${winrate})`, inline: true },

          // Linha 2
          { name: '⚔️ K/D Ratio', value: `${kd}`, inline: true },
          { name: '🎯 Headshots %', value: `${hsPercent}`, inline: true },
          { name: '🔫 Kills / Deaths', value: `${kills} / ${deaths}`, inline: true },

          // Linha 3
          { name: '⚠️ Advertências', value: `${advertencias}`, inline: false },

          // Bloco com SteamID64
          { name: '🆔 SteamID64', value: steamid64 && steamid64 !== 'N/A' ? `\`\`\`${steamid64}\`\`\`` : '```Não informado```', inline: false }
        )
        .setFooter({ text: 'Mix Trupe • Estatísticas do Servidor' })
        .setTimestamp();

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

      const replyPayload = { embeds: [embedPlayer] };
      if (rowButtons.components.length > 0) {
        replyPayload.components = [rowButtons];
      }

      await interaction.editReply(replyPayload);

    } catch (error) {
      console.error('Erro ao buscar player:', error);
      await interaction.editReply({ content: '⚠️ Erro ao consultar a planilha de dados.' });
    }
  }

  // --- COMANDOS /CONECTAR E /SERVER (SEM BULLET POINTS DE INSTRUÇÃO) ---
  if (commandName === 'conectar' || commandName === 'server') {
    const embedServers = new EmbedBuilder()
      .setTitle('🎮 SERVIDORES DA TRUPE (CS2)')
      .setColor(0x1E88E5)
      .addFields(
        { 
          name: '🖥️ SERVIDOR 01', 
          value: '```connect 103.14.27.41:27001; password 000009```', 
          inline: false 
        },
        { 
          name: '🖥️ SERVIDOR 02', 
          value: '```connect 103.14.27.41:27002; password 000009```', 
          inline: false 
        },
        { 
          name: '🖥️ SERVIDOR 03', 
          value: '```connect 103.14.27.41:27003; password 605946```', 
          inline: false 
        },
        { 
          name: '🖥️ SERVIDOR 04', 
          value: '```connect 103.14.27.41:27004; password 860913```', 
          inline: false 
        }
      )
      .setFooter({ text: 'Copie a linha do servidor desejado e cole no console do CS2' })
      .setTimestamp();

    await interaction.reply({
      embeds: [embedServers]
    });
  }

  // --- COMANDO /REGRAS (PAINEL INTERATIVO COM DROPDOWN) ---
  if (commandName === 'regras') {
    const embedRegrasBase = new EmbedBuilder()
      .setTitle('📜 Central de Regras e Orientações — Mix Trupe CS2')
      .setColor(0xE74C3C)
      .setDescription(
        'Seja bem-vindo ao **Mix Trupe**!\n\n' +
        'Selecione uma categoria no **menu suspenso abaixo** para visualizar as regras detalhadas sobre a comunidade, filas e pontuações.'
      )
      .setFooter({ text: 'Clique no menu abaixo para navegar' })
      .setTimestamp();

    const selectMenu = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId('select_regras')
        .setPlaceholder('📌 Clique aqui para escolher a categoria das regras...')
        .addOptions(
          new StringSelectMenuOptionBuilder()
            .setLabel('Conduta e Punições')
            .setDescription('Respeito, comportamento, advertências e proibições')
            .setValue('regras_conduta')
            .setEmoji('⚖️'),
          new StringSelectMenuOptionBuilder()
            .setLabel('Funcionamento da Presença e Servidores')
            .setDescription('Como jogar, confirmar presença, vetos e conexões')
            .setValue('regras_filas')
            .setEmoji('🎮'),
          new StringSelectMenuOptionBuilder()
            .setLabel('Sistema de Elo e Stats')
            .setDescription('Regras de pontuação, vitorias, derrotas e bônus')
            .setValue('regras_elo')
            .setEmoji('🏆')
        )
    );

    await interaction.reply({
      embeds: [embedRegrasBase],
      components: [selectMenu]
    });
  }

  // --- DEMAIS COMANDOS DA APLICAÇÃO ---
  if (commandName === 'resultado') {
    if (!(await ehAdministrador(interaction))) {
      return await interaction.reply({ 
        content: '❌ Apenas membros com o cargo **Owner** ou **Directors** podem usar este comando!', 
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

  if (commandName === 'presenca') {
    const sub = interaction.options.getSubcommand();

    if (sub === 'criar') {
      if (!(await ehAdministrador(interaction))) {
        return await interaction.reply({
          content: '❌ Apenas membros com o cargo **Owner** ou **Directors** podem abrir a lista de presença!',
          ephemeral: true
        });
      }

      const vagas = interaction.options.getInteger('vagas');
      presencaConfig = {
        aberta: true,
        capacidade: vagas,
        jogadores: [],
        canalId: interaction.channelId,
        mensagemId: null,
      };

      const mensagem = await interaction.reply({
        embeds: [construirEmbedPresenca(`📅 Nova Lista de Presença Aberta! [0/${vagas}]`, 0x3498DB)],
        fetchReply: true
      });

      presencaConfig.mensagemId = mensagem.id;
      return;
    }

    if (sub === 'confirmar') {
      if (!presencaConfig.aberta) {
        return await interaction.reply({
          content: '⚠️ Não há nenhuma lista de presença aberta no momento. Peça a um Owner/Directors para usar `/presenca criar`.',
          ephemeral: true
        });
      }

      const usuarioOpcao = interaction.options.getUser('jogador');
      const targetUser = usuarioOpcao || interaction.user;
      const marcandoOutro = usuarioOpcao && usuarioOpcao.id !== interaction.user.id;

      if (marcandoOutro) {
        const targetRegistrado = await jogadorEstaRegistrado(targetUser.id);
        if (!targetRegistrado) {
          return await interaction.reply({
            content: `❌ <@${targetUser.id}> ainda não possui cadastro via \`/registrar\` e não pode ser adicionado à lista.`,
            ephemeral: true
          });
        }
      }

      await interaction.deferReply({ ephemeral: true });

      try {
        const sheetJogadores = await getSheet('Jogadores');
        const rows = await sheetJogadores.getRows();
        const rowJogador = rows.find(r => r.get('discord_id') === targetUser.id);

        const statusBloqueio = await verificarBloqueioJogador(rowJogador);
        if (statusBloqueio.bloqueado) {
          return await interaction.editReply({ content: statusBloqueio.motivo });
        }
      } catch (err) {
        console.error('Erro na checagem de bloqueio da presença:', err);
      }

      if (presencaConfig.jogadores.some(p => p.id === targetUser.id)) {
        return await interaction.editReply({
          content: `⚠️ ${marcandoOutro ? 'Esse jogador já está na lista' : 'Você já confirmou sua presença'}!`
        });
      }

      if (presencaConfig.jogadores.length >= presencaConfig.capacidade) {
        return await interaction.editReply({ content: '❌ A lista de presença já está cheia!' });
      }

      const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
      const displayName = targetMember ? targetMember.displayName : targetUser.username;

      presencaConfig.jogadores.push({ id: targetUser.id, name: displayName, timestamp: Date.now() });
      const posicao = presencaConfig.jogadores.length;
      const faltam = presencaConfig.capacidade - posicao;

      await interaction.editReply({
        content: `✅ Presença confirmada para **${displayName}**! Posição na lista: **${posicao}/${presencaConfig.capacidade}**.`
      });

      if (faltam === 0) {
        const listaOrdenada = [...presencaConfig.jogadores].sort((a, b) => a.timestamp - b.timestamp);
        const mencoes = listaOrdenada.map(p => `<@${p.id}>`).join(' ');
        const listaNomes = listaOrdenada.map((p, i) => `**${i + 1}.** ${p.name}`).join('\n');

        await interaction.channel.send({
          content: `🔔 ${mencoes}`,
          embeds: [
            new EmbedBuilder()
              .setTitle('🚀 LISTA CHEIA! PARTIDA PRONTA!')
              .setColor(0x2ECC71)
              .setDescription(`**Jogadores Confirmados:**\n${listaNomes}\n\n⚔️ Use \`/sortear\` ou \`/pick\` para organizar os times e vetos!`)
              .setTimestamp()
          ]
        });

        presencaConfig.aberta = false;
      }

      const painelAtualizado = await atualizarPainelPresenca();
      if (!painelAtualizado) {
        await interaction.followUp({
          content: '⚠️ Sua presença foi registrada, mas não consegui atualizar o painel fixo (ele pode ter sido apagado, ou o bot reiniciou desde o `/presenca criar`). Peça a um Owner/Directors para rodar `/presenca criar` de novo.',
          ephemeral: true
        });
      }
      return;
    }

    if (sub === 'cancelar') {
      const usuarioOpcao = interaction.options.getUser('jogador');
      const targetUser = usuarioOpcao || interaction.user;
      const cancelandoOutro = usuarioOpcao && usuarioOpcao.id !== interaction.user.id;

      const idx = presencaConfig.jogadores.findIndex(p => p.id === targetUser.id);
      if (idx === -1) {
        return await interaction.reply({
          content: `⚠️ ${cancelandoOutro ? 'Esse jogador não estava na lista' : 'Sua presença não estava confirmada'}.`,
          ephemeral: true
        });
      }

      const [removido] = presencaConfig.jogadores.splice(idx, 1);

      await interaction.reply({
        content: `❌ Presença de **${removido.name}** cancelada. Vagas restantes: **${presencaConfig.capacidade - presencaConfig.jogadores.length}**.`,
        ephemeral: true
      });

      const painelAtualizado = await atualizarPainelPresenca();
      if (!painelAtualizado) {
        await interaction.followUp({
          content: '⚠️ A presença foi cancelada, mas não consegui atualizar o painel fixo. Peça a um Owner/Directors para rodar `/presenca criar` de novo se precisar dele.',
          ephemeral: true
        });
      }
      return;
    }

    if (sub === 'lista') {
      return await interaction.reply({ embeds: [construirEmbedPresenca()], ephemeral: true });
    }

    if (sub === 'finalizar') {
      if (!(await ehAdministrador(interaction))) {
        return await interaction.reply({
          content: '❌ Apenas membros com o cargo **Owner** ou **Directors** podem finalizar a lista de presença!',
          ephemeral: true
        });
      }

      if (!presencaConfig.aberta) {
        return await interaction.reply({
          content: '⚠️ Não há nenhuma lista de presença aberta para finalizar.',
          ephemeral: true
        });
      }

      presencaConfig.aberta = false;

      const listaOrdenada = [...presencaConfig.jogadores].sort((a, b) => a.timestamp - b.timestamp);

      if (listaOrdenada.length === 0) {
        await interaction.reply({ content: '🔒 Lista de presença encerrada. Nenhum jogador havia confirmado.' });
        const painelVazioAtualizado = await atualizarPainelPresenca();
        if (!painelVazioAtualizado) {
          await interaction.followUp({
            content: '⚠️ Não consegui atualizar o painel fixo. Peça a um Owner/Directors para rodar `/presenca criar` de novo se precisar dele.',
            ephemeral: true
          });
        }
        return;
      }

      const mencoes = listaOrdenada.map(p => `<@${p.id}>`).join(' ');
      const listaNomes = listaOrdenada.map((p, i) => `**${i + 1}.** ${p.name}`).join('\n');

      await interaction.reply({
        content: `🔒 ${mencoes}`,
        embeds: [
          new EmbedBuilder()
            .setTitle('🔒 Lista de Presença Encerrada!')
            .setColor(0xE67E22)
            .setDescription(`**Jogadores Confirmados (${listaOrdenada.length}/${presencaConfig.capacidade}):**\n${listaNomes}\n\n⚔️ Use \`/sortear\` ou \`/pick\` para organizar os times e vetos!`)
            .setTimestamp()
        ]
      });

      const painelAtualizado = await atualizarPainelPresenca();
      if (!painelAtualizado) {
        await interaction.followUp({
          content: '⚠️ Não consegui atualizar o painel fixo. Peça a um Owner/Directors para rodar `/presenca criar` de novo se precisar dele.',
          ephemeral: true
        });
      }
      return;
    }
  }

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

  if (commandName === 'mover-times') {
    if (!(await ehAdministrador(interaction))) {
      return await interaction.reply({ 
        content: '❌ Apenas membros com o cargo **Owner** ou **Directors** podem mover membros!', 
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

  if (commandName === 'reunir') {
    if (!(await ehAdministrador(interaction))) {
      return await interaction.reply({ 
        content: '❌ Apenas membros com o cargo **Owner** ou **Directors** podem usar este comando!', 
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

  if (commandName === 'sortear') {
    const origem = interaction.options.getString('origem') || 'voz';

    if (origem === 'voz' && !interaction.member.voice.channel) {
      return interaction.reply({
        content: '❌ Você precisa estar em um canal de voz para usar este comando! (ou use `origem: Lista de Presença`)',
        ephemeral: true,
      });
    }

    if (origem === 'presenca' && presencaConfig.jogadores.length < 2) {
      return interaction.reply({
        content: '❌ A lista de presença precisa ter pelo menos 2 jogadores confirmados para sortear.',
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    let membrosParaSortear = [];

    if (origem === 'presenca') {
      const listaOrdenada = [...presencaConfig.jogadores].sort((a, b) => a.timestamp - b.timestamp);
      for (const p of listaOrdenada) {
        const membro = await interaction.guild.members.fetch(p.id).catch(() => null);
        if (membro && !membro.user.bot) membrosParaSortear.push(membro);
      }
    } else {
      membrosParaSortear = Array.from(interaction.member.voice.channel.members.values()).filter(m => !m.user.bot);
    }

    if (membrosParaSortear.length < 2) {
      return interaction.editReply({
        content: '❌ É necessário ter pelo menos 2 pessoas para sortear.'
      });
    }

    function parseRank(displayName) {
      // A tag de rank vem sempre antes do separador vertical no nick (ex: "♛ 𝕊𝕊 ┃ Nick",
      // "✶𝖡 ┃ Nick"). Dois detalhes desses nicks quebravam o parser antigo:
      // 1) o separador não é o "|" normal, é o caractere decorativo "┃" (e variantes parecidas);
      // 2) as letras do rank usam fontes unicode estilizadas (𝖲𝖲, 𝕊, 𝖠, 𝖡...), não A-Z comuns.
      // normalize('NFKD') resolve o ponto 2 (converte qualquer estilo — negrito, itálico,
      // sans-serif, double-struck, etc. — de volta pra letra ASCII simples); o resto continua
      // removendo tudo que não é letra e comparando só o que restar.
      const normalizado = displayName.normalize('NFKD');
      const antesDoPipe = normalizado.split(/[|┃│∣❘｜]/)[0] || '';
      const tag = antesDoPipe.replace(/[^a-zA-Z]/g, '').toUpperCase();

      const rankMap = [
        { key: 'SS', weight: 7 },
        { key: 'S',  weight: 6 },
        { key: 'A',  weight: 5 },
        { key: 'B',  weight: 4 },
        { key: 'C',  weight: 3 },
        { key: 'D',  weight: 2 },
        { key: 'E',  weight: 0 },
      ];

      for (const rank of rankMap) {
        if (tag === rank.key) {
          return { rank: rank.key, weight: rank.weight };
        }
      }
      return { rank: 'Sem Rank', weight: 3 };
    }

    const players = membrosParaSortear.map(m => {
      const rankInfo = parseRank(m.displayName);
      return {
        name: m.displayName,
        weight: rankInfo.weight,
        rank: rankInfo.rank
      };
    });

    players.sort((a, b) => b.weight - a.weight || (Math.random() - 0.5));

    // Times de até 5 jogadores (padrão CS2 5x5). Com mais de 10 jogadores, forma
    // vários times de 5 em vez de só dois.
    const TAMANHO_TIME = 5;
    const numTimes = Math.max(2, Math.ceil(players.length / TAMANHO_TIME));

    if (numTimes > 25) {
      return await interaction.editReply({
        content: `❌ Muitos jogadores para exibir (${players.length}). Reduza a lista antes de sortear.`
      });
    }

    const tamanhoBase = Math.floor(players.length / numTimes);
    const timesComExtra = players.length % numTimes;

    const times = Array.from({ length: numTimes }, (_, i) => ({
      membros: [],
      pontos: 0,
      capacidade: tamanhoBase + (i < timesComExtra ? 1 : 0),
    }));

    players.forEach(p => {
      const disponiveis = times.filter(t => t.membros.length < t.capacidade);
      disponiveis.sort((a, b) => a.pontos - b.pontos);
      const escolhido = disponiveis[0];
      escolhido.membros.push(p);
      escolhido.pontos += p.weight;
    });

    const formatTeam = (team) => team.map(p => `• **${p.name}** \`[Rank ${p.rank} - ${p.weight} pts]\``).join('\n');

    const nomesTimes = numTimes === 2
      ? ['🔵 TIME A (CT)', '🟡 TIME B (TR)']
      : times.map((_, i) => `🎯 TIME ${i + 1}`);

    const fields = times.map((t, i) => ({
      name: `${nomesTimes[i]} — Total: ${t.pontos} pts`,
      value: formatTeam(t.membros) || 'Nenhum jogador',
      inline: false
    }));

    const diferencaMaxima = Math.max(...times.map(t => t.pontos)) - Math.min(...times.map(t => t.pontos));

    const embedSorteio = new EmbedBuilder()
      .setTitle(numTimes === 2 ? '🎲 Sorteio Balanceado de Times (CS2)' : `🎲 Sorteio Balanceado — ${numTimes} Times de CS2`)
      .setColor(0x3498DB)
      .addFields(fields)
      .setFooter({ text: `Origem: ${origem === 'presenca' ? 'Lista de Presença' : 'Canal de Voz'} • ${players.length} jogadores em ${numTimes} time(s) • Diferença máxima de equilíbrio: ${diferencaMaxima} pts` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embedSorteio] });
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

  if (commandName === 'advertir' || commandName === 'ausente') {
    if (!(await ehAdministrador(interaction))) {
      return await interaction.reply({ 
        content: '❌ Apenas membros com o cargo **Owner** ou **Directors** podem aplicar advertências!', 
        ephemeral: true 
      });
    }

    await interaction.deferReply();

    try {
      const targetUser = interaction.options.getUser('jogador');
      const tipoKey = commandName === 'ausente' ? 'falta_atraso' : interaction.options.getString('tipo');
      const tipoInfo = TIPOS_ADVERTENCIA[tipoKey] || TIPOS_ADVERTENCIA.falta_atraso;
      const motivo = commandName === 'ausente'
        ? 'Ausência / WO após confirmar presença'
        : (interaction.options.getString('motivo') || tipoInfo.label);

      const sheetJogadores = await getSheet('Jogadores');
      const rowsJogadores = await sheetJogadores.getRows();

      let rowJogador = rowsJogadores.find(r => r.get('discord_id') === targetUser.id);

      let pontosAntes = 0;
      let punicoesAntes = 0;

      if (!rowJogador) {
        rowJogador = await sheetJogadores.addRow({
          'discord_id': targetUser.id,
          'discord_nick': targetUser.username,
          'Advertências': '0',
          'Punições': '0',
          'Banido_Até': '',
          'Banido_Temporada': '',
          'elo': '1000',
          'link_faceit': 'N/A',
          'link_gc': 'N/A'
        });
      } else {
        pontosAntes = parseInt(rowJogador.get('Advertências') || 0);
        punicoesAntes = parseInt(rowJogador.get('Punições') || 0);
      }

      const pontosDepois = pontosAntes + tipoInfo.pontos;
      const punicoesDepois = Math.floor(pontosDepois / PONTOS_POR_PUNICAO);
      const novaPunicao = punicoesDepois > punicoesAntes;

      rowJogador.set('Advertências', pontosDepois.toString());
      rowJogador.set('Punições', punicoesDepois.toString());

      let statusPunicaoTexto = `✅ Nenhuma punição aplicada ainda (faltam **${PONTOS_POR_PUNICAO - (pontosDepois % PONTOS_POR_PUNICAO || PONTOS_POR_PUNICAO)}** ponto(s) para a próxima).`;

      if (novaPunicao) {
        if (punicoesDepois >= 2) {
          rowJogador.set('Banido_Temporada', 'TRUE');
          statusPunicaoTexto = `🚫 **PUNIÇÃO APLICADA!** O jogador atingiu a **${punicoesDepois}ª punição** e está **banido do Mix até o fim da temporada atual**.`;
        } else {
          const banAte = new Date(Date.now() + DURACAO_BAN_SEMANAL_MS);
          rowJogador.set('Banido_Até', banAte.toISOString());
          statusPunicaoTexto = `🚫 **PUNIÇÃO APLICADA!** O jogador atingiu a **1ª punição** e está **banido do Mix por 1 semana** (até <t:${Math.floor(banAte.getTime() / 1000)}:F>).`;
        }
      }

      await rowJogador.save();

      const embed = new EmbedBuilder()
        .setTitle(`⚖️ Advertência Registrada — ${targetUser.username}`)
        .setColor(novaPunicao ? 0xFF0000 : 0xE67E22)
        .addFields(
          { name: '👤 Jogador', value: `<@${targetUser.id}>`, inline: true },
          { name: '📌 Tipo', value: `${tipoInfo.label} (+${tipoInfo.pontos} pts)`, inline: true },
          { name: '⚠️ Pontos Totais', value: `**${pontosDepois}** pts`, inline: true },
          { name: '📝 Motivo', value: motivo, inline: false },
          { name: '🚨 Status da Punição', value: statusPunicaoTexto, inline: false }
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
        content: '❌ Apenas membros com o cargo **Owner** ou **Directors** podem remover advertências!', 
        ephemeral: true 
      });
    }

    await interaction.deferReply();

    try {
      const targetUser = interaction.options.getUser('jogador');
      const pontosOpcao = interaction.options.getInteger('pontos');

      const sheetJogadores = await getSheet('Jogadores');
      const rowsJogadores = await sheetJogadores.getRows();

      let rowJogador = rowsJogadores.find(r => r.get('discord_id') === targetUser.id);

      const pontosAntes = rowJogador ? parseInt(rowJogador.get('Advertências') || 0) : 0;

      if (!rowJogador || pontosAntes <= 0) {
        return await interaction.editReply(`✅ O jogador <@${targetUser.id}> não possui nenhuma advertência ativa.`);
      }

      const pontosDepois = pontosOpcao ? Math.max(0, pontosAntes - pontosOpcao) : 0;
      const punicoesDepois = Math.floor(pontosDepois / PONTOS_POR_PUNICAO);

      rowJogador.set('Advertências', pontosDepois.toString());
      rowJogador.set('Punições', punicoesDepois.toString());

      // Libera automaticamente as punições que já não se justificam mais com os pontos restantes
      if (punicoesDepois < 2) rowJogador.set('Banido_Temporada', '');
      if (punicoesDepois < 1) rowJogador.set('Banido_Até', '');

      await rowJogador.save();

      const embed = new EmbedBuilder()
        .setTitle(`✅ Advertências Atualizadas — ${targetUser.username}`)
        .setColor(0x2ECC71)
        .addFields(
          { name: '👤 Jogador', value: `<@${targetUser.id}>`, inline: true },
          { name: '⚠️ Pontos Restantes', value: `**${pontosDepois}** pts`, inline: true },
          { name: '🔓 Punições Ativas', value: punicoesDepois > 0 ? `${punicoesDepois}` : 'Nenhuma — jogador liberado', inline: true }
        );

      return await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Erro ao desadvertir:', error);
      await interaction.editReply('⚠️ Erro ao atualizar advertências.');
    }
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

  if (commandName === 'mudar-nick') {
    if (!(await ehAdministrador(interaction))) {
      return await interaction.reply({ 
        content: '❌ Apenas membros com o cargo **Owner** ou **Directors** podem alterar o nick de outros membros!', 
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