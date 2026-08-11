// legacy/interactionRouter.js
//
// Corpo do antigo `client.on('interactionCreate', ...)` de index.js, cortado e
// colado aqui com o mínimo de ajuste indispensável pra funcionar fora do arquivo
// original: os imports que ele usava (com os caminhos relativos corrigidos pra
// partir de legacy/), um `const client = interaction.client` no topo da função
// no lugar da variável `client` que antes vinha do escopo do módulo, e
// `atualizarPainelPresenca` passou a receber `client` por parâmetro pelo mesmo
// motivo. Nenhuma regra de negócio foi alterada.
//
// events/interactionCreate.js tenta primeiro o roteador novo (Collection de
// commands/<categoria>/); se não achar um comando lá, cai aqui. Este arquivo
// desaparece no PR9, à medida que cada comando for migrado (PRs 4-8).
//
// Ver docs/plans/modularizacao-index-js.md, PR3 (padrão strangler fig).

const {
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
  StringSelectMenuOptionBuilder,
} = require('discord.js');

// --- IMPORTAÇÃO DO SERVIÇO DE PARTIDAS (FIREGAMES) ---
const { verificarPartidaJaImportada, calcularPartida, gravarPartida } = require('../firegamesService');

// --- GOOGLE SHEETS E PERMISSÕES (compartilhados com os comandos em commands/) ---
const { doc, getSheet } = require('../utils/sheets');
const { ehAdministrador } = require('../utils/permissions');
const { CORES } = require('../utils/colors');
const { buildContainer, componentsV2Payload, MessageFlags } = require('../utils/containers');
const presencaPersistence = require('../state/presencaPersistence');

// --- COMANDOS MIGRADOS DO TRUPE-BOT (Components V2) ---
const commandModules = {
  help: require('../commands/geral/help'),
  lives: require('../commands/streamers/lives'),
  anuncio: require('../commands/geral/anuncio'),
  addstreamer: require('../commands/streamers/addstreamer'),
  removerstreamer: require('../commands/streamers/removerstreamer'),
  config: require('../commands/geral/config'),
  clear: require('../commands/moderacao/clear'),
};

// --- CONFIGURAÇÃO DE CONSTANTES ---
const MAX_ADVERTENCIAS = 3;

// Extraído para utils/servidores.js na migração de /player (compartilhado com /partida-info,
// que ainda não migrou -- por isso continua importado aqui).
const { rotuloServidor } = require('../utils/servidores');

// Converte "DD/MM/AAAA, HH:mm:ss" (formato gravado via toLocaleString('pt-BR') em
// firegamesService.js) de volta pra Date, pra alimentar o timestamp nativo do embed em
// /partida-info. Retorna null se o texto não bater com o formato esperado.
function parseDataPtBr(dataStr) {
  const m = (dataStr || '').match(/^(\d{2})\/(\d{2})\/(\d{4}),?\s*(\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, dd, mm, yyyy, hh, min, ss] = m;
  const data = new Date(`${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}`);
  return Number.isNaN(data.getTime()) ? null : data;
}

// Quanto tempo o preview do /importar-partida (botões Confirmar/Cancelar) fica válido antes de
// expirar sem gravar nada. Ver docs/adr/0002-importar-partida-preview-antes-de-gravar.md
const IMPORTAR_PARTIDA_CONFIRMACAO_TTL_MS = 10 * 60 * 1000;

// A cada X pontos de advertência acumulados, o jogador recebe 1 punição automática
const PONTOS_POR_PUNICAO = MAX_ADVERTENCIAS;
const DURACAO_BAN_SEMANAL_MS = 7 * 24 * 60 * 60 * 1000; // 1ª punição: 1 semana banido do Mix

// Tipos de advertência disponíveis em /advertir e sua pontuação
const TIPOS_ADVERTENCIA = {
  falta_atraso: { label: 'Falta ou Atraso', pontos: 1 },
  falta_respeito: { label: 'Falta de Respeito com ADM/Staff', pontos: 2 },
  ragequit_troll: { label: 'Ragequit ou Troll', pontos: 3 },
};

// Estado Global da Lista de Presença. Carregado de data/presenca.json se existir
// (sobrevive a um restart do processo -- ver state/presencaPersistence.js); cai
// no padrão abaixo (lista fechada e vazia) na primeira vez que o bot roda ou se
// o arquivo não existir/estiver corrompido.
let presencaConfig = presencaPersistence.carregar({
  aberta: false,
  capacidade: 10,
  jogadores: [], // { id, name, timestamp }
  reservas: [], // { id, name, timestamp } -- fila de espera depois que "jogadores" lota
  vagasReserva: 10, // 0 = reserva desativada pra essa lista
  canalId: null,
  mensagemId: null,
  ultimaMensagemPublicaId: null, // mensagem pública de "confirmou/cancelou" mais recente
});

// Extraídos para services/registroService.js e utils/elenco.js na migração de /x1 (comando
// 10/21) -- o cache de registro é usado por praticamente todo comando (a trava de segurança
// abaixo, entre outros) e a resolução de elenco é compartilhada com /partida-info, que ainda
// não migrou. Ver docs/adr/0001-elenco-partida-resolvido-em-tempo-de-leitura.md
const { jogadorEstaRegistrado, invalidarRegistroCache } = require('../services/registroService');
const { interpretarCelulaElenco, resolverElencoParaExibicao } = require('../utils/elenco');

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

// --- FUNÇÕES AUXILIARES: PAINEL DE PRESENÇA (mensagem fixa que se auto-atualiza) ---
function construirEmbedPresenca(tituloOverride, corOverride) {
  const listaOrdenada = [...presencaConfig.jogadores].sort((a, b) => a.timestamp - b.timestamp);
  const lista = listaOrdenada
    .map((p, i) => `**${i + 1}.** ${p.name}`)
    .join('\n') || '*Nenhuma presença confirmada ainda.*';

  const cheia = presencaConfig.jogadores.length >= presencaConfig.capacidade;
  const reservaAtiva = presencaConfig.vagasReserva > 0;

  // Seção de Reserva: só aparece quando a lista oficial já lotou e a reserva está ativa
  // pra essa lista (vagas_reserva > 0 no /presenca criar). Bloco de texto simples, no mesmo
  // description -- redesenho visual completo (addFields, cores por seção) fica pra uma
  // sessão de design futura, ver memory "next-session-design-pass".
  let descricao = lista;
  if (presencaConfig.aberta && cheia && reservaAtiva) {
    const reservaOrdenada = [...presencaConfig.reservas].sort((a, b) => a.timestamp - b.timestamp);
    const listaReserva = reservaOrdenada
      .map((p, i) => `**${i + 1}.** ${p.name}`)
      .join('\n') || '*Ninguém na reserva ainda.*';
    descricao += `\n\n🕒 **Reserva [${presencaConfig.reservas.length}/${presencaConfig.vagasReserva}]:**\n${listaReserva}`;
  }

  // Três estados possíveis: aberta (aceitando confirmação direta), cheia-com-reserva-aberta
  // (aceitando só reserva) e encerrada (via /presenca finalizar -- única forma de fechar tudo
  // de vez, a lista não fecha mais sozinha ao lotar).
  let statusTitulo;
  let corPadrao;
  let footerTexto;
  if (!presencaConfig.aberta) {
    statusTitulo = `<:trupe_bloqueado:1536410479273185330> Lista de Presença Encerrada [${presencaConfig.jogadores.length}/${presencaConfig.capacidade}]`;
    corPadrao = CORES.ENCERRADO;
    footerTexto = 'Lista encerrada. Peça a um ADM/Directors para abrir uma nova com /presenca criar.';
  } else if (cheia && reservaAtiva) {
    statusTitulo = `⏳ Lista Cheia — Reserva Aberta [${presencaConfig.jogadores.length}/${presencaConfig.capacidade}]`;
    corPadrao = CORES.NEUTRO;
    footerTexto = 'Lista oficial cheia! Use /presenca confirmar para entrar na fila de reserva.';
  } else {
    statusTitulo = `<:trupe_presenca:1536411530944446546> Lista de Presença [${presencaConfig.jogadores.length}/${presencaConfig.capacidade}]`;
    corPadrao = CORES.AVISO;
    footerTexto = 'Use /presenca confirmar para garantir sua vaga! A ordem é de quem confirmou primeiro.';
  }

  return new EmbedBuilder()
    .setTitle(tituloOverride || statusTitulo)
    .setColor(corOverride || corPadrao)
    .setDescription(descricao)
    .setFooter({ text: footerTexto })
    .setTimestamp();
}

async function atualizarPainelPresenca(client) {
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

// Mensagem PÚBLICA de "última atualização" da presença (confirmou/cancelou), visível pro
// canal inteiro -- diferente do painel fixo acima, que é editado em silêncio (o Discord não
// notifica edição, então é fácil passar despercebido). Em vez de mandar uma mensagem nova a
// cada ação (o que lotaria o canal com histórico de cada confirmação), apaga a anterior e
// manda uma nova: sempre só uma mensagem "viva", que sobe pro fim do chat a cada atualização.
// O ID fica salvo em presencaConfig.ultimaMensagemPublicaId (persistido, sobrevive a restart).
async function atualizarMensagemPublicaPresenca(interaction, conteudo) {
  try {
    if (presencaConfig.ultimaMensagemPublicaId) {
      const antiga = await interaction.channel.messages.fetch(presencaConfig.ultimaMensagemPublicaId).catch(() => null);
      if (antiga) await antiga.delete().catch(() => {});
    }

    const nova = await interaction.channel.send({ content: conteudo, embeds: [construirEmbedPresenca()] });
    presencaConfig.ultimaMensagemPublicaId = nova.id;
    presencaPersistence.salvar(presencaConfig);
  } catch (err) {
    console.error('Erro ao atualizar mensagem pública de presença:', err);
  }
}

// Mesma checagem de ban/punição usada em /presenca confirmar, extraída pra ser reaproveitada
// também na promoção de Reserva (automática e manual via /presenca promover) -- um jogador só
// passa por essa checagem no momento em que confirma ou entra na reserva, que pode ter sido
// dias atrás, então vale reconferir antes de efetivamente promover alguém.
async function statusBloqueioPorDiscordId(discordId) {
  try {
    const sheetJogadores = await getSheet('Jogadores');
    const rows = await sheetJogadores.getRows();
    const rowJogador = rows.find(r => r.get('discord_id') === discordId);
    return await verificarBloqueioJogador(rowJogador);
  } catch (err) {
    console.error('Erro na checagem de bloqueio (presença):', err);
    return { bloqueado: false }; // falha aberto -- mesma postura já usada no /presenca confirmar
  }
}

// Manda uma DM "melhor esforço" -- várias pessoas têm DM aberta pra bots, então vale tentar,
// mas nunca deixa uma DM fechada/bloqueada quebrar o fluxo do comando (a notificação pública
// já cobre o essencial, isso aqui é só um extra).
async function enviarDMBestEffort(client, userId, mensagem) {
  try {
    const user = await client.users.fetch(userId);
    await user.send(mensagem);
  } catch (err) {
    // Ignorado de propósito -- DM fechada é um caso normal, não um erro a reportar.
  }
}

// Promove o primeiro da Reserva (por ordem de chegada) pra "jogadores", pulando -- sem
// promover -- quem estiver bloqueado agora (reconfere via statusBloqueioPorDiscordId).
// Devolve a entrada promovida, ou null se a reserva estava vazia ou todo mundo nela está
// bloqueado no momento.
async function promoverPrimeiroDaReserva() {
  while (presencaConfig.reservas.length > 0) {
    const reservaOrdenada = [...presencaConfig.reservas].sort((a, b) => a.timestamp - b.timestamp);
    const candidato = reservaOrdenada[0];

    const statusBloqueio = await statusBloqueioPorDiscordId(candidato.id);
    if (statusBloqueio.bloqueado) {
      presencaConfig.reservas = presencaConfig.reservas.filter(p => p.id !== candidato.id);
      presencaPersistence.salvar(presencaConfig);
      continue;
    }

    presencaConfig.reservas = presencaConfig.reservas.filter(p => p.id !== candidato.id);
    presencaConfig.jogadores.push(candidato);
    presencaPersistence.salvar(presencaConfig);
    return candidato;
  }
  return null;
}

// --- EXECUÇÃO DAS INTERAÇÕES (corpo original, sem alteração de lógica) ---
async function executarRoteadorLegado(interaction) {
  const client = interaction.client;


  // ==========================================
  // 0. PROCESSAMENTO DE MENUS DE SELEÇÃO (SELECT MENU)
  // ==========================================
  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === 'select_regras') {
      const opcao = interaction.values[0];

      const CATEGORIAS_REGRAS = {
        regras_conduta: {
          titulo: '<:trupe_teia:1536412408203976888> Regras de Conduta e Punições',
          cor: CORES.ERRO,
          corpo: [
            '**1. Respeito em Primeiro Lugar**',
            'Proibido qualquer tipo de ofensas pesadas, discriminação, racismo, homofobia ou toxicidade extrema no chat de voz ou texto.',
            '',
            '**2. Ausências e WO**',
            'Não comparecer após confirmar presença acarretará em advertência automática via `/ausente` (1 ponto).',
            '',
            '**3. Pontos e Punições**',
            `Advertências valem **1 a 3 pontos**, de acordo com o tipo. A cada **${PONTOS_POR_PUNICAO} pontos** acumulados o jogador recebe 1 punição automática: a **1ª** bloqueia o \`/presenca confirmar\` por **1 semana**; a **2ª** bane o jogador do Mix até o **fim da temporada atual**.`,
          ].join('\n'),
        },
        regras_filas: {
          titulo: '<:trupe_teia:1536412408203976888> Funcionamento da Presença e Servidores',
          cor: CORES.INFO,
          corpo: [
            '**1. Confirmação de Presença**',
            'Apenas jogadores cadastrados via `/registrar` podem confirmar presença com `/presenca confirmar`.',
            '',
            '**2. Fechamento da Lista**',
            'Assim que a lista de presença atinge o número de vagas definido em `/presenca criar`, o bot notifica todos e os capitães iniciam a fase de veto com `/pick`.',
            '',
            '**3. Conexão Direta**',
            'Utilize o comando `connect` exibido em `/server` para entrar no servidor do CS2.',
          ].join('\n'),
        },
        regras_elo: {
          titulo: '<:trupe_teia:1536412408203976888> Sistema de Elo e Estatísticas',
          cor: CORES.AVISO,
          corpo: [
            '**1. Pontuação Base**',
            'Todos os jogadores começam com **1000 de Elo** base no cadastro.',
            '',
            '**2. Vitórias e Derrotas**',
            'Vitórias concedem em média **+25 Elo** e derrotas removem em média **-20 Elo**.',
            '',
            '**3. Bônus de Performance (ADR)**',
            'Jogadores com ADR alto (>100) recebem bônus extra de Elo na partida (+5 pts).',
          ].join('\n'),
        },
      };

      const categoria = CATEGORIAS_REGRAS[opcao];
      if (!categoria) return;

      return await interaction.reply(componentsV2Payload(
        buildContainer({ cor: categoria.cor, titulo: categoria.titulo, corpo: categoria.corpo }),
        { ephemeral: true }
      ));
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
          content: '<:trupe_erro:1536410911617843322> **SteamID64 inválido!** Insira o número de 17 dígitos (ex: `76561198012345678`) ou o link direto do perfil da Steam.'
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
          .setTitle('<:trupe_teia:1536412408203976888> Cadastro Concluído no Mix Trupe!')
          .setColor(CORES.SUCESSO)
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
          content: '<:trupe_aviso:1536410370829328434> Erro ao salvar na planilha. Verifique as permissões da Service Account.'
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
        const jaImportada = await verificarPartidaJaImportada(doc, idPartida, servidorId);
        if (jaImportada) {
          return await interaction.editReply(
            `<:trupe_erro:1536410911617843322> A partida **#${idPartida}** do servidor \`${servidorId}\` já foi importada antes. ` +
            `Reimportar criaria uma linha duplicada — confira a aba **Partidas** se precisar corrigir algo.`
          );
        }

        // Calcula tudo (elenco, vencedor, MVP, variação de Elo) SEM gravar nada ainda — só grava
        // depois de o admin confirmar pelo botão, pra não sujar o Elo/stats de quem está
        // cadastrado com um import que acabou saindo errado. Ver docs/adr/0002.
        const pending = await calcularPartida(idPartida, servidorId, mapa, doc, scoreA, scoreB);

        const listaTimeA = pending.nomesTimeA.length > 0 ? pending.nomesTimeA.join(', ') : 'Sem jogadores';
        const listaTimeB = pending.nomesTimeB.length > 0 ? pending.nomesTimeB.join(', ') : 'Sem jogadores';

        const previewContent =
          `📋 **Pré-visualização da Partida #${idPartida}** (servidor \`${servidorId}\`)\n\n` +
          `🔵 **Time A (${scoreA})**: ${listaTimeA}\n` +
          `🟡 **Time B (${scoreB})**: ${listaTimeB}\n` +
          `🏆 **Vencedor**: ${pending.teamWinnerLabel}\n\n` +
          `⚠️ **Confira se o placar bateu com o time certo antes de confirmar.** Depois de gravado, o Elo/stats de quem está cadastrado não volta atrás sozinho.`;

        const rowBotoes = new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId('confirmar_importar_partida')
            .setLabel('Confirmar e Gravar')
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId('cancelar_importar_partida')
            .setLabel('Cancelar')
            .setStyle(ButtonStyle.Danger)
        );

        const previewMessage = await interaction.editReply({ content: previewContent, components: [rowBotoes] });

        const collector = previewMessage.createMessageComponentCollector({
          componentType: ComponentType.Button,
          time: IMPORTAR_PARTIDA_CONFIRMACAO_TTL_MS
        });

        collector.on('collect', async i => {
          if (i.user.id !== interaction.user.id) {
            return i.reply({
              content: '<:trupe_erro:1536410911617843322> Só quem rodou o `/importar-partida` pode confirmar ou cancelar esse import.',
              ephemeral: true
            });
          }

          if (i.customId === 'cancelar_importar_partida') {
            await i.update({ content: `${previewContent}\n\n❌ **Importação cancelada.** Nada foi gravado.`, components: [] });
            return collector.stop('CONCLUIDO');
          }

          await i.update({ content: `${previewContent}\n\n⏳ Gravando...`, components: [] });

          try {
            await gravarPartida(pending, doc);
            await interaction.editReply({
              content:
                `<:trupe_sucesso:1536412279778574356> **Partida #${idPartida}** importada com sucesso!\n\n` +
                `🔵 **Time A (${scoreA})**: ${listaTimeA}\n` +
                `🟡 **Time B (${scoreB})**: ${listaTimeB}\n` +
                `🏆 **Vencedor**: ${pending.teamWinnerLabel}`,
              components: []
            });
          } catch (err) {
            console.error('Erro ao gravar partida confirmada:', err);
            await interaction.editReply({
              content: `<:trupe_erro:1536410911617843322> Erro ao gravar a partida depois da confirmação: ${err.message}`,
              components: []
            });
          }

          collector.stop('CONCLUIDO');
        });

        collector.on('end', async (collected, reason) => {
          if (reason !== 'CONCLUIDO') {
            await interaction.editReply({
              content: `${previewContent}\n\n⏱️ **Tempo esgotado.** Nada foi gravado — rode \`/importar-partida\` novamente se ainda quiser importar.`,
              components: []
            }).catch(() => {});
          }
        });

      } catch (err) {
        console.error(err);
        return await interaction.editReply(`<:trupe_erro:1536410911617843322> **Erro ao importar partida:** ${err.message}`);
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
  const comandosLiberados = ['registrar', 'regras', 'server'];

  if (!comandosLiberados.includes(commandName)) {
    const registrado = await jogadorEstaRegistrado(interaction.user.id);

    if (!registrado) {
      const embedTrava = new EmbedBuilder()
        .setTitle('<:trupe_bloqueado:1536410479273185330> Acesso Negado!')
        .setColor(CORES.ERRO)
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
        content: '<:trupe_erro:1536410911617843322> Apenas membros com o cargo **Owner** ou **Directors** podem cadastrar outro jogador!',
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
        content: '<:trupe_erro:1536410911617843322> Apenas membros com o cargo **Owner** ou **Directors** podem usar este comando!', 
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
  // /player migrou para commands/stats/player.js (migração legacy -> modular, comando 7/21).

  // --- COMANDO /SERVER ---
  // /server migrou para commands/servidor/server.js (migração legacy -> modular, comando 1/21).

  // --- COMANDO /REGRAS (PAINEL INTERATIVO COM DROPDOWN) ---
  // /regras migrou para commands/servidor/regras.js (migração legacy -> modular, comando 2/21).
  // O handler do select 'select_regras' logo acima (seção 0) continua aqui de propósito.

  // --- DEMAIS COMANDOS DA APLICAÇÃO ---
  if (commandName === 'resultado') {
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
  }

  if (commandName === 'presenca') {
    const sub = interaction.options.getSubcommand();

    if (sub === 'criar') {
      if (!(await ehAdministrador(interaction))) {
        return await interaction.reply({
          content: '<:trupe_erro:1536410911617843322> Apenas membros com o cargo **Owner** ou **Directors** podem abrir a lista de presença!',
          ephemeral: true
        });
      }

      const vagas = interaction.options.getInteger('vagas');
      const vagasReserva = interaction.options.getInteger('vagas_reserva') ?? 10;
      presencaConfig = {
        aberta: true,
        capacidade: vagas,
        jogadores: [],
        reservas: [],
        vagasReserva,
        canalId: interaction.channelId,
        mensagemId: null,
        ultimaMensagemPublicaId: null, // nova lista, nao ha mensagem publica anterior pra apagar
      };

      const mensagem = await interaction.reply({
        embeds: [construirEmbedPresenca(`<:trupe_presenca:1536411530944446546> Nova Lista de Presença Aberta! [0/${vagas}]`, CORES.INFO)],
        fetchReply: true
      });

      presencaConfig.mensagemId = mensagem.id;
      presencaPersistence.salvar(presencaConfig);
      return;
    }

    if (sub === 'confirmar') {
      if (!presencaConfig.aberta) {
        return await interaction.reply({
          content: '<:trupe_aviso:1536410370829328434> Não há nenhuma lista de presença aberta no momento. Peça a um Owner/Directors para usar `/presenca criar`.',
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
            content: `<:trupe_erro:1536410911617843322> <@${targetUser.id}> ainda não possui cadastro via \`/registrar\` e não pode ser adicionado à lista.`,
            ephemeral: true
          });
        }
      }

      await interaction.deferReply({ ephemeral: true });

      const statusBloqueio = await statusBloqueioPorDiscordId(targetUser.id);
      if (statusBloqueio.bloqueado) {
        return await interaction.editReply({ content: statusBloqueio.motivo });
      }

      if (presencaConfig.jogadores.some(p => p.id === targetUser.id)) {
        return await interaction.editReply({
          content: `<:trupe_aviso:1536410370829328434> ${marcandoOutro ? 'Esse jogador já está na lista' : 'Você já confirmou sua presença'}!`
        });
      }
      if (presencaConfig.reservas.some(p => p.id === targetUser.id)) {
        return await interaction.editReply({
          content: `<:trupe_aviso:1536410370829328434> ${marcandoOutro ? 'Esse jogador já está na reserva' : 'Você já está na reserva'}!`
        });
      }

      const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
      const displayName = targetMember ? targetMember.displayName : targetUser.username;

      // Lista oficial cheia -- em vez de recusar, encaminha pra Reserva (a menos que a Reserva
      // esteja desativada ou também cheia). Ver docs/adr/0003-lista-de-presenca-nunca-fecha-sozinha.md / CONTEXT.md.
      if (presencaConfig.jogadores.length >= presencaConfig.capacidade) {
        if (presencaConfig.vagasReserva === 0) {
          return await interaction.editReply({ content: '<:trupe_erro:1536410911617843322> A lista de presença já está cheia!' });
        }
        if (presencaConfig.reservas.length >= presencaConfig.vagasReserva) {
          return await interaction.editReply({ content: '<:trupe_erro:1536410911617843322> A lista oficial e a reserva já estão cheias!' });
        }

        presencaConfig.reservas.push({ id: targetUser.id, name: displayName, timestamp: Date.now() });
        presencaPersistence.salvar(presencaConfig);
        const posicaoReserva = presencaConfig.reservas.length;

        await interaction.editReply({
          content: `<:trupe_aviso:1536410370829328434> A lista oficial já foi concluída! **${displayName}** entrou na reserva, posição **${posicaoReserva}/${presencaConfig.vagasReserva}**. No cancelamento de presença de algum confirmado, por ordem de chegada, os reservas vão repor a vaga.`
        });

        await atualizarMensagemPublicaPresenca(
          interaction,
          `🕒 **${displayName}** entrou na reserva! (**${posicaoReserva}/${presencaConfig.vagasReserva}**)`
        );

        const painelAtualizadoReserva = await atualizarPainelPresenca(client);
        if (!painelAtualizadoReserva) {
          await interaction.followUp({
            content: '<:trupe_aviso:1536410370829328434> Você entrou na reserva, mas não consegui atualizar o painel fixo (ele pode ter sido apagado, ou o bot reiniciou desde o `/presenca criar`). Peça a um Owner/Directors para rodar `/presenca criar` de novo.',
            ephemeral: true
          });
        }
        return;
      }

      presencaConfig.jogadores.push({ id: targetUser.id, name: displayName, timestamp: Date.now() });
      presencaPersistence.salvar(presencaConfig);
      const posicao = presencaConfig.jogadores.length;
      const faltam = presencaConfig.capacidade - posicao;

      await interaction.editReply({
        content: `<:trupe_sucesso:1536412279778574356> Presença confirmada para **${displayName}**! Posição na lista: **${posicao}/${presencaConfig.capacidade}**.`
      });

      if (faltam !== 0) {
        // Confirmação PÚBLICA, visível pro canal inteiro (a editReply acima é ephemeral, só
        // quem rodou o comando vê) -- sem isso, ninguém enxerga quem já confirmou e perde o
        // incentivo de entrar na lista também. Quando a lista lota, o aviso "LISTA CHEIA" logo
        // abaixo já é público e já mostra todo mundo confirmado, então não repete aqui.
        await atualizarMensagemPublicaPresenca(
          interaction,
          `<:trupe_sucesso:1536412279778574356> **${displayName}** confirmou presença! (**${posicao}/${presencaConfig.capacidade}**)`
        );
      }

      if (faltam === 0) {
        const listaOrdenada = [...presencaConfig.jogadores].sort((a, b) => a.timestamp - b.timestamp);
        const mencoes = listaOrdenada.map(p => `<@${p.id}>`).join(' ');
        const listaNomes = listaOrdenada.map((p, i) => `**${i + 1}.** ${p.name}`).join('\n');
        const avisoReserva = presencaConfig.vagasReserva > 0
          ? '\n\n🕒 A partir de agora, quem confirmar presença entra na fila de reserva.'
          : '';

        await interaction.channel.send({
          content: `🔔 ${mencoes}`,
          embeds: [
            new EmbedBuilder()
              .setTitle('🚀 LISTA CHEIA! PARTIDA PRONTA!')
              .setColor(CORES.SUCESSO)
              .setDescription(`**Jogadores Confirmados:**\n${listaNomes}\n\n⚔️ Use \`/sortear\` ou \`/pick\` para organizar os times e vetos!${avisoReserva}`)
              .setTimestamp()
          ]
        });

        // A lista não fecha mais sozinha ao lotar -- só /presenca finalizar fecha de vez
        // (oficial + reserva). "aberta" continua true, então novas confirmações a partir daqui
        // caem na Reserva (ramo acima). Ver docs/adr/0003-lista-de-presenca-nunca-fecha-sozinha.md.
      }

      const painelAtualizado = await atualizarPainelPresenca(client);
      if (!painelAtualizado) {
        await interaction.followUp({
          content: '<:trupe_aviso:1536410370829328434> Sua presença foi registrada, mas não consegui atualizar o painel fixo (ele pode ter sido apagado, ou o bot reiniciou desde o `/presenca criar`). Peça a um Owner/Directors para rodar `/presenca criar` de novo.',
          ephemeral: true
        });
      }
      return;
    }

    if (sub === 'cancelar') {
      const usuarioOpcao = interaction.options.getUser('jogador');
      const targetUser = usuarioOpcao || interaction.user;
      const cancelandoOutro = usuarioOpcao && usuarioOpcao.id !== interaction.user.id;

      const idxJogador = presencaConfig.jogadores.findIndex(p => p.id === targetUser.id);
      const idxReserva = idxJogador === -1 ? presencaConfig.reservas.findIndex(p => p.id === targetUser.id) : -1;

      if (idxJogador === -1 && idxReserva === -1) {
        return await interaction.reply({
          content: `<:trupe_aviso:1536410370829328434> ${cancelandoOutro ? 'Esse jogador não estava na lista' : 'Sua presença não estava confirmada'}.`,
          ephemeral: true
        });
      }

      // Cancelando alguém que só estava na Reserva -- remove e pronto, ninguém é promovido
      // (a fila de quem já estava atrás dele não muda de tamanho nem de ordem).
      if (idxReserva !== -1) {
        const [removidoReserva] = presencaConfig.reservas.splice(idxReserva, 1);
        presencaPersistence.salvar(presencaConfig);

        await interaction.reply({
          content: `<:trupe_erro:1536410911617843322> **${removidoReserva.name}** saiu da reserva.`,
          ephemeral: true
        });

        await atualizarMensagemPublicaPresenca(
          interaction,
          `<:trupe_erro:1536410911617843322> **${removidoReserva.name}** saiu da reserva. (**${presencaConfig.reservas.length}/${presencaConfig.vagasReserva}**)`
        );

        const painelAtualizadoReserva = await atualizarPainelPresenca(client);
        if (!painelAtualizadoReserva) {
          await interaction.followUp({
            content: '<:trupe_aviso:1536410370829328434> A saída da reserva foi registrada, mas não consegui atualizar o painel fixo. Peça a um Owner/Directors para rodar `/presenca criar` de novo se precisar dele.',
            ephemeral: true
          });
        }
        return;
      }

      const [removido] = presencaConfig.jogadores.splice(idxJogador, 1);
      presencaPersistence.salvar(presencaConfig);

      // Promove automaticamente o primeiro da Reserva (por ordem de chegada) pra repor a vaga
      // que acabou de abrir -- ver docs/adr/0003-lista-de-presenca-nunca-fecha-sozinha.md / CONTEXT.md.
      const promovido = await promoverPrimeiroDaReserva();

      await interaction.reply({
        content: promovido
          ? `<:trupe_erro:1536410911617843322> Presença de **${removido.name}** cancelada. **${promovido.name}** foi promovido da reserva pra sua vaga!`
          : `<:trupe_erro:1536410911617843322> Presença de **${removido.name}** cancelada. Vagas restantes: **${presencaConfig.capacidade - presencaConfig.jogadores.length}**.`,
        ephemeral: true
      });

      // Aviso PÚBLICO, mesmo padrão do /presenca confirmar -- uma única mensagem "viva" cobrindo
      // o cancelamento e a promoção (se houve), pra uma não sobrescrever a outra (ver
      // atualizarMensagemPublicaPresenca -- só existe uma mensagem "viva" por vez).
      await atualizarMensagemPublicaPresenca(
        interaction,
        promovido
          ? `<:trupe_erro:1536410911617843322> **${removido.name}** cancelou a presença. 🔁 **${promovido.name}** foi promovido da reserva! (**${presencaConfig.jogadores.length}/${presencaConfig.capacidade}**)`
          : `<:trupe_erro:1536410911617843322> **${removido.name}** cancelou a presença. (**${presencaConfig.jogadores.length}/${presencaConfig.capacidade}**)`
      );

      if (promovido) {
        await enviarDMBestEffort(
          client,
          promovido.id,
          `🔁 Você foi promovido da reserva e agora está **confirmado** na Lista de Presença (vaga de **${removido.name}**)! Confira com \`/presenca lista\`.`
        );
      }

      const painelAtualizado = await atualizarPainelPresenca(client);
      if (!painelAtualizado) {
        await interaction.followUp({
          content: '<:trupe_aviso:1536410370829328434> A presença foi cancelada, mas não consegui atualizar o painel fixo. Peça a um Owner/Directors para rodar `/presenca criar` de novo se precisar dele.',
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
          content: '<:trupe_erro:1536410911617843322> Apenas membros com o cargo **Owner** ou **Directors** podem finalizar a lista de presença!',
          ephemeral: true
        });
      }

      if (!presencaConfig.aberta) {
        return await interaction.reply({
          content: '<:trupe_aviso:1536410370829328434> Não há nenhuma lista de presença aberta para finalizar.',
          ephemeral: true
        });
      }

      presencaConfig.aberta = false;
      presencaPersistence.salvar(presencaConfig);

      const listaOrdenada = [...presencaConfig.jogadores].sort((a, b) => a.timestamp - b.timestamp);

      if (listaOrdenada.length === 0) {
        await interaction.reply({ content: '<:trupe_bloqueado:1536410479273185330> Lista de presença encerrada. Nenhum jogador havia confirmado.' });
        const painelVazioAtualizado = await atualizarPainelPresenca(client);
        if (!painelVazioAtualizado) {
          await interaction.followUp({
            content: '<:trupe_aviso:1536410370829328434> Não consegui atualizar o painel fixo. Peça a um Owner/Directors para rodar `/presenca criar` de novo se precisar dele.',
            ephemeral: true
          });
        }
        return;
      }

      const mencoes = listaOrdenada.map(p => `<@${p.id}>`).join(' ');
      const listaNomes = listaOrdenada.map((p, i) => `**${i + 1}.** ${p.name}`).join('\n');

      // Reserva que não entrou dessa vez -- avisado aqui pra ninguém ficar sem saber se
      // "ainda está na fila" depois que a lista já encerrou de vez.
      const reservaOrdenada = [...presencaConfig.reservas].sort((a, b) => a.timestamp - b.timestamp);
      const avisoReservaFinal = reservaOrdenada.length > 0
        ? `\n\n🕒 **Não entraram dessa vez (Reserva):** ${reservaOrdenada.map(p => p.name).join(', ')}`
        : '';

      await interaction.reply({
        content: `<:trupe_bloqueado:1536410479273185330> ${mencoes}`,
        embeds: [
          new EmbedBuilder()
            .setTitle('<:trupe_bloqueado:1536410479273185330> Lista de Presença Encerrada!')
            .setColor(CORES.NEUTRO)
            .setDescription(`**Jogadores Confirmados (${listaOrdenada.length}/${presencaConfig.capacidade}):**\n${listaNomes}\n\n⚔️ Use \`/sortear\` ou \`/pick\` para organizar os times e vetos!${avisoReservaFinal}`)
            .setTimestamp()
        ]
      });

      const painelAtualizado = await atualizarPainelPresenca(client);
      if (!painelAtualizado) {
        await interaction.followUp({
          content: '<:trupe_aviso:1536410370829328434> Não consegui atualizar o painel fixo. Peça a um Owner/Directors para rodar `/presenca criar` de novo se precisar dele.',
          ephemeral: true
        });
      }
      return;
    }

    if (sub === 'promover') {
      if (!(await ehAdministrador(interaction))) {
        return await interaction.reply({
          content: '<:trupe_erro:1536410911617843322> Apenas membros com o cargo **Owner** ou **Directors** podem promover jogadores da reserva!',
          ephemeral: true
        });
      }

      if (!presencaConfig.aberta) {
        return await interaction.reply({
          content: '<:trupe_aviso:1536410370829328434> Não há nenhuma lista de presença aberta no momento.',
          ephemeral: true
        });
      }

      const alvoPromover = interaction.options.getUser('jogador');
      const alvoRemover = interaction.options.getUser('remover');

      const idxReserva = presencaConfig.reservas.findIndex(p => p.id === alvoPromover.id);
      if (idxReserva === -1) {
        return await interaction.reply({
          content: `<:trupe_erro:1536410911617843322> <@${alvoPromover.id}> não está na reserva.`,
          ephemeral: true
        });
      }

      await interaction.deferReply({ ephemeral: true });

      const statusBloqueio = await statusBloqueioPorDiscordId(alvoPromover.id);
      if (statusBloqueio.bloqueado) {
        return await interaction.editReply({ content: statusBloqueio.motivo });
      }

      // Se a lista oficial já está cheia, promover exige trocar com alguém -- "remover" é
      // obrigatório nesse caso. Se sobrou vaga de verdade (raro), promove direto e ignora
      // "remover" mesmo que tenha sido informado. Ver docs/adr/0003-lista-de-presenca-nunca-fecha-sozinha.md.
      const temVaga = presencaConfig.jogadores.length < presencaConfig.capacidade;

      let removido = null;
      if (!temVaga) {
        if (!alvoRemover) {
          return await interaction.editReply({
            content: `<:trupe_erro:1536410911617843322> A lista oficial está cheia -- informe também **remover** (quem sai pra abrir a vaga de <@${alvoPromover.id}>).`
          });
        }
        const idxJogador = presencaConfig.jogadores.findIndex(p => p.id === alvoRemover.id);
        if (idxJogador === -1) {
          return await interaction.editReply({
            content: `<:trupe_erro:1536410911617843322> <@${alvoRemover.id}> não está na lista de confirmados.`
          });
        }
        [removido] = presencaConfig.jogadores.splice(idxJogador, 1);
      }

      const [promovido] = presencaConfig.reservas.splice(idxReserva, 1);
      presencaConfig.jogadores.push(promovido);
      presencaPersistence.salvar(presencaConfig);

      await interaction.editReply({
        content: removido
          ? `<:trupe_sucesso:1536412279778574356> **${promovido.name}** promovido da reserva no lugar de **${removido.name}**.`
          : `<:trupe_sucesso:1536412279778574356> **${promovido.name}** promovido da reserva!`
      });

      await atualizarMensagemPublicaPresenca(
        interaction,
        removido
          ? `🔁 Um ADM trocou **${removido.name}** por **${promovido.name}** (da reserva) na lista de confirmados! (**${presencaConfig.jogadores.length}/${presencaConfig.capacidade}**)`
          : `🔁 Um ADM promoveu **${promovido.name}** da reserva! (**${presencaConfig.jogadores.length}/${presencaConfig.capacidade}**)`
      );

      await enviarDMBestEffort(
        client,
        promovido.id,
        '🔁 Um administrador te promoveu da reserva -- você agora está **confirmado** na Lista de Presença! Confira com `/presenca lista`.'
      );
      if (removido) {
        await enviarDMBestEffort(
          client,
          removido.id,
          'ℹ️ Um administrador removeu sua confirmação na Lista de Presença pra abrir vaga pra outro jogador da reserva. Se ainda quiser participar, use `/presenca confirmar` pra entrar na reserva.'
        );
      }

      const painelAtualizadoPromover = await atualizarPainelPresenca(client);
      if (!painelAtualizadoPromover) {
        await interaction.followUp({
          content: '<:trupe_aviso:1536410370829328434> A promoção foi registrada, mas não consegui atualizar o painel fixo. Peça a um Owner/Directors para rodar `/presenca criar` de novo se precisar dele.',
          ephemeral: true
        });
      }
      return;
    }
  }

  // /elo migrou para commands/stats/elo.js (migração legacy -> modular, comando 6/21).

  // /hall-da-fama migrou para commands/stats/hall-da-fama.js (migração legacy -> modular, comando 9/21).

  // /x1 migrou para commands/stats/x1.js (migração legacy -> modular, comando 10/21).

  // /mover-times migrou para commands/voz/mover-times.js (migração legacy -> modular, comando 4/21).

  // /reunir migrou para commands/voz/reunir.js (migração legacy -> modular, comando 5/21).

  if (commandName === 'sortear') {
    const origem = interaction.options.getString('origem') || 'voz';

    if (origem === 'voz' && !interaction.member.voice.channel) {
      return interaction.reply({
        content: '<:trupe_erro:1536410911617843322> Você precisa estar em um canal de voz para usar este comando! (ou use `origem: Lista de Presença`)',
        ephemeral: true,
      });
    }

    if (origem === 'presenca' && presencaConfig.jogadores.length < 2) {
      return interaction.reply({
        content: '<:trupe_erro:1536410911617843322> A lista de presença precisa ter pelo menos 2 jogadores confirmados para sortear.',
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
        content: '<:trupe_erro:1536410911617843322> É necessário ter pelo menos 2 pessoas para sortear.'
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
        content: `<:trupe_erro:1536410911617843322> Muitos jogadores para exibir (${players.length}). Reduza a lista antes de sortear.`
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
      .setTitle(numTimes === 2 ? '<:trupe_teia:1536412408203976888> Sorteio Balanceado de Times (CS2)' : `<:trupe_teia:1536412408203976888> Sorteio Balanceado — ${numTimes} Times de CS2`)
      .setColor(CORES.INFO)
      .addFields(fields)
      .setFooter({ text: `Origem: ${origem === 'presenca' ? 'Lista de Presença' : 'Canal de Voz'} • ${players.length} jogadores em ${numTimes} time(s) • Diferença máxima de equilíbrio: ${diferencaMaxima} pts` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embedSorteio] });
  }

  // /ranking migrou para commands/stats/ranking.js (migração legacy -> modular, comando 8/21).

  if (commandName === 'stats-mapa') {
    // A flag IsComponentsV2 precisa ser declarada já aqui -- não dá pra adicionar depois via editReply.
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

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

        return await interaction.editReply(componentsV2Payload(
          buildContainer({
            cor: CORES.SUCESSO,
            titulo: '<:trupe_teia:1536412408203976888> Estatísticas de Mapas da Comunidade',
            corpo: `🔥 **Mapas Mais Jogados**\n${mapasOrdenados}`,
            rodape: 'Use /stats-mapa [mapa] para ver o Rei do Mapa!',
          })
        ));
      }

      if (mapaFiltro && !jogadorFiltro) {
        const partidasDoMapa = rowsPartidas.filter(r => (r.get('map') || '').toLowerCase() === mapaFiltro.toLowerCase());
        const statsDoMapa = rowsStats.filter(r => (r.get('map') || '').toLowerCase() === mapaFiltro.toLowerCase());

        if (partidasDoMapa.length === 0) {
          return await interaction.editReply(componentsV2Payload(
            buildContainer({ cor: CORES.AVISO, titulo: 'Sem dados', corpo: `<:trupe_aviso:1536410370829328434> Nenhuma partida registrada no mapa **${mapaFiltro}** ainda.` })
          ));
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

        const corpoMapa = [
          `🎮 **Total de Partidas**: ${partidasDoMapa.length}`,
          '',
          '👑 **Rei do Mapa**',
          reiDoMapa ? `**${reiDoMapa.nick}**\nK/D: \`${melhorKD.toFixed(2)}\` (${reiDoMapa.kills}K / ${reiDoMapa.deaths}D em ${reiDoMapa.jogos} partida/s)` : 'Sem dados',
        ].join('\n');

        return await interaction.editReply(componentsV2Payload(
          buildContainer({ cor: CORES.AVISO, titulo: `<:trupe_teia:1536412408203976888> Estatísticas do Mapa: ${mapaFiltro}`, corpo: corpoMapa })
        ));
      }

      if (mapaFiltro && jogadorFiltro) {
        const statsJogador = rowsStats.filter(r => 
          r.get('discord_id') === jogadorFiltro.id && 
          (r.get('map') || '').toLowerCase() === mapaFiltro.toLowerCase()
        );

        if (statsJogador.length === 0) {
          return await interaction.editReply(componentsV2Payload(
            buildContainer({ cor: CORES.AVISO, titulo: 'Sem dados', corpo: `<:trupe_aviso:1536410370829328434> O jogador <@${jogadorFiltro.id}> não possui dados gravados no mapa **${mapaFiltro}**.` })
          ));
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

        const corpoJogador = [
          `**Partidas**: ${partidasQtd}`,
          `**K / D / A**: ${totalKills} / ${totalDeaths} / ${totalAssists}`,
          `**K/D Ratio**: ${kdRatio}`,
          `**ADR Médio**: ${adrMedio}`,
        ].join('\n');

        return await interaction.editReply(componentsV2Payload(
          buildContainer({ cor: CORES.INFO, titulo: `<:trupe_teia:1536412408203976888> ${jogadorFiltro.username} no mapa ${mapaFiltro}`, corpo: corpoJogador })
        ));
      }
    } catch (error) {
      console.error('Erro no /stats-mapa:', error);
      await interaction.editReply(componentsV2Payload(
        buildContainer({ cor: CORES.AVISO, titulo: 'Erro', corpo: '<:trupe_aviso:1536410370829328434> Erro ao consultar as estatísticas por mapa.' })
      ));
    }
  }

  if (commandName === 'partida-info') {
    // A flag IsComponentsV2 precisa ser declarada já aqui -- não dá pra adicionar depois via editReply.
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

    try {
      const idBuscado = interaction.options.getString('id');
      const servidorBuscado = interaction.options.getString('servidor');
      const sheetPartidas = await getSheet('Partidas');
      const rowsPartidas = await sheetPartidas.getRows();

      if (rowsPartidas.length === 0) {
        return await interaction.editReply(componentsV2Payload(
          buildContainer({ cor: CORES.AVISO, titulo: 'Sem partidas', corpo: '<:trupe_aviso:1536410370829328434> Nenhuma partida encontrada no sistema.' })
        ));
      }

      // matchid sozinho não é único entre servidores (cada servidor tem sua própria numeração
      // do MatchZy) — por isso o filtro por servidor, quando informado, é aplicado junto.
      let candidatos = rowsPartidas;
      if (idBuscado) candidatos = candidatos.filter(r => r.get('matchid') === idBuscado);
      if (servidorBuscado) candidatos = candidatos.filter(r => r.get('server_id') === servidorBuscado);

      let partida;
      if (idBuscado) {
        if (candidatos.length > 1) {
          // Mesmo ID em mais de um servidor e nenhum "servidor" pra desambiguar — lista as
          // opções em vez de chutar uma (podia ser a errada).
          const lista = candidatos
            .map(c => `• \`#${c.get('matchid')}\` — **${rotuloServidor(c.get('server_id'))}** — ${c.get('date') || 'N/I'} (${c.get('map') || 'N/I'})`)
            .join('\n');
          return await interaction.editReply(componentsV2Payload(
            buildContainer({
              cor: CORES.AVISO,
              titulo: 'Vários resultados',
              corpo: `<:trupe_aviso:1536410370829328434> Encontrei **${candidatos.length} partidas** com o ID \`#${idBuscado}\` em servidores diferentes:\n\n${lista}\n\nRode de novo especificando a opção **servidor** pra escolher qual.`,
            })
          ));
        }
        partida = candidatos[0];
        if (!partida) {
          return await interaction.editReply(componentsV2Payload(
            buildContainer({ cor: CORES.ERRO, titulo: 'Não encontrada', corpo: `<:trupe_erro:1536410911617843322> Partida ID \`#${idBuscado}\`${servidorBuscado ? ` no ${rotuloServidor(servidorBuscado)}` : ''} não foi encontrada.` })
          ));
        }
      } else {
        if (candidatos.length === 0) {
          return await interaction.editReply(componentsV2Payload(
            buildContainer({ cor: CORES.ERRO, titulo: 'Não encontrada', corpo: `<:trupe_erro:1536410911617843322> Nenhuma partida encontrada${servidorBuscado ? ` no ${rotuloServidor(servidorBuscado)}` : ''}.` })
          ));
        }
        partida = candidatos[candidatos.length - 1];
      }

      // Elenco resolvido na hora contra a aba Jogadores — ver docs/adr/0001-elenco-partida-resolvido-em-tempo-de-leitura.md
      const linhasTimeA = await resolverElencoParaExibicao(interpretarCelulaElenco(partida.get('team_a_ids')));
      const linhasTimeB = await resolverElencoParaExibicao(interpretarCelulaElenco(partida.get('team_b_ids')));
      // Numerada, no mesmo estilo já usado no painel de presença (construirEmbedPresenca).
      const idsA = linhasTimeA.map((linha, i) => `**${i + 1}.** ${linha}`).join('\n');
      const idsB = linhasTimeB.map((linha, i) => `**${i + 1}.** ${linha}`).join('\n');
      const temNaoCadastrado = [...linhasTimeA, ...linhasTimeB].some(l => l.includes('❔'));

      const vencedor = partida.get('team_winner') || '';
      // Azul se Time A venceu, dourado se Time B venceu (mesmas cores dos ícones de Time A/B do
      // elenco); roxo neutro se não der pra saber (linha antiga sem vencedor reconhecível).
      const corPorVencedor = vencedor.includes('A') ? CORES.INFO : vencedor.includes('B') ? CORES.AVISO : 0x9B59B6;

      // Data/Hora ganha um timestamp nativo do Discord (<t:...:F>, com "há Xh" automático) --
      // Components V2 não tem o .setTimestamp() do embed clássico, então o relógio precisa
      // entrar embutido no próprio texto.
      const dataPartida = parseDataPtBr(partida.get('date'));
      const dataTexto = dataPartida
        ? `<t:${Math.floor(dataPartida.getTime() / 1000)}:F>`
        : (partida.get('date') || 'N/I');

      const corpo = [
        `<:trupe_presenca:1536411530944446546> **Data/Hora**: ${dataTexto}`,
        `<:trupe_mapa:1536413320397979718> **Mapa**: ${partida.get('map') || 'N/I'}`,
        `<a:trupe_trofeu:1536412945339129857> **Time Vencedor**: ${vencedor || 'N/I'}`,
        '',
        `<:trupe_time_a:1536412456010907669> **Time A (${partida.get('score_a') || 0})**`,
        idsA || 'Sem jogadores',
        '',
        `<:trupe_time_b:1536412484133715988> **Time B (${partida.get('score_b') || 0})**`,
        idsB || 'Sem jogadores',
        '',
        `<:trupe_mvp:1536411420202373120> **MVP**: ${partida.get('mvp') || 'N/A'}`,
        `<:trupe_player_video:1536413056085655572> **Link Demos/Stats**: ${partida.get('link_demo_and_stats') || 'Não informado'}`,
      ].join('\n');

      return await interaction.editReply(componentsV2Payload(
        buildContainer({
          cor: corPorVencedor,
          titulo: `<:trupe_teia:1536412408203976888> Detalhes da Partida #${partida.get('matchid')} — ${rotuloServidor(partida.get('server_id'))}`,
          corpo,
          rodape: temNaoCadastrado
            ? 'Mix Trupe CS2 • ❔ = jogador ainda não fez /registrar'
            : 'Mix Trupe CS2 • Estatísticas de Partidas',
        })
      ));
    } catch (error) {
      console.error('Erro no /partida-info:', error);
      await interaction.editReply(componentsV2Payload(
        buildContainer({ cor: CORES.AVISO, titulo: 'Erro', corpo: '<:trupe_aviso:1536410370829328434> Erro ao consultar os dados da partida.' })
      ));
    }
  }

  if (commandName === 'advertir' || commandName === 'ausente') {
    if (!(await ehAdministrador(interaction))) {
      return await interaction.reply({ 
        content: '<:trupe_erro:1536410911617843322> Apenas membros com o cargo **Owner** ou **Directors** podem aplicar advertências!', 
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

      let statusPunicaoTexto = `<:trupe_sucesso:1536412279778574356> Nenhuma punição aplicada ainda (faltam **${PONTOS_POR_PUNICAO - (pontosDepois % PONTOS_POR_PUNICAO || PONTOS_POR_PUNICAO)}** ponto(s) para a próxima).`;

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
        .setTitle(`<:trupe_teia:1536412408203976888> Advertência Registrada — ${targetUser.username}`)
        .setColor(novaPunicao ? CORES.ERRO : CORES.NEUTRO)
        .addFields(
          { name: '👤 Jogador', value: `<@${targetUser.id}>`, inline: true },
          { name: '📌 Tipo', value: `${tipoInfo.label} (+${tipoInfo.pontos} pts)`, inline: true },
          { name: '<:trupe_aviso:1536410370829328434> Pontos Totais', value: `**${pontosDepois}** pts`, inline: true },
          { name: '📝 Motivo', value: motivo, inline: false },
          { name: '🚨 Status da Punição', value: statusPunicaoTexto, inline: false }
        )
        .setTimestamp();

      return await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Erro ao advertir:', error);
      await interaction.editReply('<:trupe_aviso:1536410370829328434> Erro ao registrar a advertência na planilha.');
    }
  }

  if (commandName === 'desadvertir') {
    if (!(await ehAdministrador(interaction))) {
      return await interaction.reply({ 
        content: '<:trupe_erro:1536410911617843322> Apenas membros com o cargo **Owner** ou **Directors** podem remover advertências!', 
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
        return await interaction.editReply(`<:trupe_sucesso:1536412279778574356> O jogador <@${targetUser.id}> não possui nenhuma advertência ativa.`);
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
        .setTitle(`<:trupe_teia:1536412408203976888> Advertências Atualizadas — ${targetUser.username}`)
        .setColor(CORES.SUCESSO)
        .addFields(
          { name: '👤 Jogador', value: `<@${targetUser.id}>`, inline: true },
          { name: '<:trupe_aviso:1536410370829328434> Pontos Restantes', value: `**${pontosDepois}** pts`, inline: true },
          { name: '🔓 Punições Ativas', value: punicoesDepois > 0 ? `${punicoesDepois}` : 'Nenhuma — jogador liberado', inline: true }
        );

      return await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Erro ao desadvertir:', error);
      await interaction.editReply('<:trupe_aviso:1536410370829328434> Erro ao atualizar advertências.');
    }
  }

  if (commandName === 'pick') {
    const modo = interaction.options.getString('modo');
    const capA = interaction.options.getUser('capitao_a') || interaction.user;
    const capB = interaction.options.getUser('capitao_b');

    if (!capB) {
      return interaction.reply({
        content: '<:trupe_erro:1536410911617843322> Você precisa especificar o **Capitão do Time B** (`capitao_b`) para iniciar o veto!',
        ephemeral: true
      });
    }

    if (capA.id === capB.id) {
      return interaction.reply({
        content: '<:trupe_erro:1536410911617843322> O Capitão A e o Capitão B não podem ser a mesma pessoa!',
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
          const acaoTexto = step.acao === 'BAN' ? '<:trupe_erro:1536410911617843322> **BANIR**' : '<:trupe_sucesso:1536412279778574356> **ESCOLHER (PICK)**';
          statusTexto = `Vez de <@${step.team.id}> (${step.teamName}) para ${acaoTexto} um mapa!`;
        } else {
          statusTexto = '🎉 **Processo de Veto Concluído!**';
        }
      }

      let historicoBans = bans.map(b => `• <:trupe_erro:1536410911617843322> ~${b.mapa}~ *(por ${b.teamName})*`).join('\n') || 'Nenhum mapa banido ainda.';
      let historicoPicks = picks.map(p => `• <:trupe_sucesso:1536412279778574356> **${p.mapa}** *(Pick ${p.teamName})* — Lado do ${p.sideTeamName}: **${p.lado}**`).join('\n') || 'Nenhum mapa escolhido ainda.';

      const embed = new EmbedBuilder()
        .setTitle(`<:trupe_teia:1536412408203976888> Veto de Mapas (${modo}) — Mix Trupe`)
        .setColor(aguardandoEscolhaLado ? CORES.NEUTRO : (passos[passoAtual] ? (passos[passoAtual].acao === 'BAN' ? CORES.ERRO : CORES.SUCESSO) : CORES.AVISO))
        .setDescription(`🔵 **Time A (Capitão):** <@${capA.id}>\n🟡 **Time B (Capitão):** <@${capB.id}>\n\n📢 **Status Atual:**\n${statusTexto}`)
        .addFields(
          { name: '🚫 Mapas Banidos', value: historicoBans, inline: false },
          { name: '🎯 Mapas Escolhidos', value: modo === 'MD3' ? historicoPicks : (picks.length ? `• <:trupe_sucesso:1536412279778574356> **${picks[0].mapa}**` : 'Nenhum'), inline: false },
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
            content: `<:trupe_erro:1536410911617843322> Apenas <@${timeEscolhendoLadoPendente.id}> pode escolher o lado para este mapa!`,
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
          content: `<:trupe_erro:1536410911617843322> Apenas o capitão da vez (<@${stepAtual.team.id}>) pode realizar esta ação!`,
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

  // /mudar-nick migrou para commands/jogadores/mudar-nick.js (migração legacy -> modular, comando 3/21).
}

// Usado pelo roteador novo (events/interactionCreate.js) pra reproduzir a mesma
// mensagem de trava de cadastro em comandos migrados que exijam registro
// (nenhum ainda em PR3 -- todos os que já saíram pro Collection têm
// exigeRegistro: false -- mas o roteador novo já está preparado pra quando o
// primeiro comando "exigente" for migrado, nos PRs 5-8).
function responderTravaDeRegistro(interaction) {
  const embedTrava = new EmbedBuilder()
    .setTitle('<:trupe_bloqueado:1536410479273185330> Acesso Negado!')
    .setColor(CORES.ERRO)
    .setDescription(
      `Olá <@${interaction.user.id}>! Para utilizar qualquer comando do bot e participar do **Mix Trupe**, você precisa vincular o seu **SteamID64** primeiro.\n\n` +
      `👉 Execute o comando abaixo para abrir o formulário de cadastro:\n` +
      `\`\`\`\n/registrar\n\`\`\``
    )
    .setFooter({ text: 'Sistema de Proteção e Estatísticas do Mix Trupe' });

  return interaction.reply({ embeds: [embedTrava], ephemeral: true });
}

module.exports = {
  execute: executarRoteadorLegado,
  jogadorEstaRegistrado,
  invalidarRegistroCache,
  responderTravaDeRegistro,
};
