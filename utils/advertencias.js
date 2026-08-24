// Extraído de legacy/interactionRouter.js na migração de /desadvertir (comando 14/21) --
// compartilhado com o texto do select_regras (ainda no legado) e com /advertir e /ausente.
const { EmbedBuilder } = require('discord.js');
const { ehAdministrador } = require('./permissions');
const { getSheet } = require('./sheets');
const { CORES } = require('./colors');
const { enviarNotificacaoDM } = require('../services/notificacoesService');
const { BANNERS } = require('./banners');

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

// Lógica compartilhada entre /advertir e /ausente -- extraída na migração de /advertir (comando
// 15/21). 'ausente' é literalmente 'advertir' com tipo e motivo fixos (ver seus respectivos
// commands/moderacao/*.js), então em vez de duplicar leitura/escrita na planilha + cálculo de
// punição + embed em dois arquivos, os dois chamam esta função passando o que muda.
async function registrarAdvertencia(interaction, { tipoKey, motivoFixo }) {
  if (!(await ehAdministrador(interaction))) {
    return await interaction.reply({
      content: '<:trupe_erro:1536410911617843322> Apenas membros com o cargo **Owner** ou **Directors** podem aplicar advertências!',
      ephemeral: true
    });
  }

  await interaction.deferReply();

  try {
    const targetUser = interaction.options.getUser('jogador');
    const tipoInfo = TIPOS_ADVERTENCIA[tipoKey] || TIPOS_ADVERTENCIA.falta_atraso;
    const motivo = motivoFixo || (interaction.options.getString('motivo') || tipoInfo.label);

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

    // Título de embed não renderiza menção (<@id> só vira link clicável em description/fields,
    // não em title/footer/author) -- por isso usa o apelido do servidor, não o username cru.
    const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    const displayName = targetMember ? targetMember.displayName : targetUser.username;

    const embed = new EmbedBuilder()
      .setTitle(`<:trupe_teia:1536412408203976888> Advertência Registrada — ${displayName}`)
      .setColor(novaPunicao ? CORES.ERRO : CORES.NEUTRO)
      .addFields(
        { name: '👤 Jogador', value: `<@${targetUser.id}>`, inline: true },
        { name: '📌 Tipo', value: `${tipoInfo.label} (+${tipoInfo.pontos} pts)`, inline: true },
        { name: '<:trupe_aviso:1536410370829328434> Pontos Totais', value: `**${pontosDepois}** pts`, inline: true },
        { name: '📝 Motivo', value: motivo, inline: false },
        { name: '🚨 Status da Punição', value: statusPunicaoTexto, inline: false }
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });

    await enviarNotificacaoDM(interaction.client, targetUser.id, {
      bannerKey: BANNERS.ADVERTENCIA,
      cor: CORES.ERRO,
      titulo: '<:trupe_aviso:1536410370829328434> Você recebeu uma advertência',
      corpo: `**Tipo**: ${tipoInfo.label} (+${tipoInfo.pontos} pts)\n**Motivo**: ${motivo}\n**Pontos totais**: ${pontosDepois} pts\n\n${statusPunicaoTexto}`,
    });
  } catch (error) {
    console.error('Erro ao advertir:', error);
    await interaction.editReply('<:trupe_aviso:1536410370829328434> Erro ao registrar a advertência na planilha.');
  }
}

module.exports = { MAX_ADVERTENCIAS, PONTOS_POR_PUNICAO, DURACAO_BAN_SEMANAL_MS, TIPOS_ADVERTENCIA, registrarAdvertencia };
