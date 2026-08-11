const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { ehAdministrador } = require('../../utils/permissions');
const { getSheet } = require('../../utils/sheets');
const { CORES } = require('../../utils/colors');
const presencaStore = require('../../state/presencaStore');
const presencaPersistence = require('../../state/presencaPersistence');
const { jogadorEstaRegistrado } = require('../../services/registroService');
const { enviarNotificacaoDM } = require('../../services/notificacoesService');
const { BANNERS } = require('../../utils/banners');

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
  const presencaConfig = presencaStore.obter();
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
  const presencaConfig = presencaStore.obter();
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
  const presencaConfig = presencaStore.obter();
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

// Notificação por DM com banner (ver services/notificacoesService.js) -- "melhor esforço": DM
// fechada/bloqueada é um caso normal, não quebra o fluxo do comando (a notificação pública no
// canal já cobre o essencial, a DM é só um extra).

// Promove o primeiro da Reserva (por ordem de chegada) pra "jogadores", pulando -- sem
// promover -- quem estiver bloqueado agora (reconfere via statusBloqueioPorDiscordId).
// Devolve a entrada promovida, ou null se a reserva estava vazia ou todo mundo nela está
// bloqueado no momento.
async function promoverPrimeiroDaReserva() {
  const presencaConfig = presencaStore.obter();
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

module.exports = {
  // exigeRegistro fica no default (true) -- 'presenca' não estava em
  // comandosLiberados no legado, então já exigia cadastro antes desta migração.

  data: new SlashCommandBuilder()
    .setName('presenca')
    .setDescription('Confirmação de presença antecipada para o próximo Mix')
    .addSubcommand(sub =>
      sub.setName('criar')
        .setDescription('[Owner/Directors] Abre uma nova lista de presença com limite de vagas')
        .addIntegerOption(opt =>
          opt.setName('vagas')
            .setDescription('Número total de vagas (ex: 10)')
            .setRequired(true)
        )
        .addIntegerOption(opt =>
          opt.setName('vagas_reserva')
            .setDescription('Vagas na reserva após a lista lotar (padrão: 10; use 0 pra desativar)')
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub.setName('confirmar')
        .setDescription('Confirma sua presença (ou a de outro jogador registrado) no próximo Mix')
        .addUserOption(opt =>
          opt.setName('jogador')
            .setDescription('Confirmar a presença de outro jogador registrado (deixe em branco para confirmar a sua)')
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub.setName('cancelar')
        .setDescription('Cancela sua presença (ou a de outro jogador) no próximo Mix')
        .addUserOption(opt =>
          opt.setName('jogador')
            .setDescription('Cancelar a presença de outro jogador (deixe em branco para cancelar a sua)')
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub.setName('lista')
        .setDescription('Exibe a lista atual de confirmados, ordenada por prioridade')
    )
    .addSubcommand(sub =>
      sub.setName('finalizar')
        .setDescription('[Owner/Directors] Encerra a lista de presença atual, mesmo sem atingir as vagas')
    )
    .addSubcommand(sub =>
      sub.setName('promover')
        .setDescription('[Owner/Directors] Promove um jogador da reserva pra lista de confirmados, fora da ordem')
        .addUserOption(opt =>
          opt.setName('jogador')
            .setDescription('Jogador da reserva a promover')
            .setRequired(true)
        )
        .addUserOption(opt =>
          opt.setName('remover')
            .setDescription('Jogador confirmado a remover pra abrir vaga (obrigatório se a lista oficial estiver cheia)')
            .setRequired(false)
        )
    ),

  async execute(interaction) {
    const client = interaction.client;
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
      let presencaConfig = presencaStore.definir({
        aberta: true,
        capacidade: vagas,
        jogadores: [],
        reservas: [],
        vagasReserva,
        canalId: interaction.channelId,
        mensagemId: null,
        ultimaMensagemPublicaId: null, // nova lista, nao ha mensagem publica anterior pra apagar
      });

      const mensagem = await interaction.reply({
        embeds: [construirEmbedPresenca(`<:trupe_presenca:1536411530944446546> Nova Lista de Presença Aberta! [0/${vagas}]`, CORES.INFO)],
        fetchReply: true
      });

      presencaConfig.mensagemId = mensagem.id;
      presencaPersistence.salvar(presencaConfig);
      return;
    }

    if (sub === 'confirmar') {
      const presencaConfig = presencaStore.obter();

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
      const presencaConfig = presencaStore.obter();
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
        await enviarNotificacaoDM(client, promovido.id, {
          bannerKey: BANNERS.PROMOVIDO,
          cor: CORES.SUCESSO,
          titulo: '<:trupe_sucesso:1536412279778574356> Você foi promovido da reserva!',
          corpo: `Você agora está **confirmado** na Lista de Presença (vaga de **${removido.name}**)! Confira com \`/presenca lista\`.`,
        });
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

      const presencaConfig = presencaStore.obter();

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

      const presencaConfig = presencaStore.obter();

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

      await enviarNotificacaoDM(client, promovido.id, {
        bannerKey: BANNERS.PROMOVIDO,
        cor: CORES.SUCESSO,
        titulo: '<:trupe_sucesso:1536412279778574356> Você foi promovido da reserva!',
        corpo: 'Um administrador te promoveu da reserva -- você agora está **confirmado** na Lista de Presença! Confira com `/presenca lista`.',
      });
      if (removido) {
        // Sem banner próprio -- não é um dos 6 eventos com banner personalizado, só um aviso.
        await enviarNotificacaoDM(client, removido.id, {
          cor: CORES.AVISO,
          titulo: '<:trupe_aviso:1536410370829328434> Você saiu da Lista de Presença',
          corpo: 'Um administrador removeu sua confirmação na Lista de Presença pra abrir vaga pra outro jogador da reserva. Se ainda quiser participar, use `/presenca confirmar` pra entrar na reserva.',
        });
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
  },
};
