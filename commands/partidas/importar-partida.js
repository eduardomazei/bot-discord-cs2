const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
} = require('discord.js');
const { ehAdministrador } = require('../../utils/permissions');
const { doc } = require('../../utils/sheets');
const { rotuloServidor } = require('../../utils/servidores');
const { CORES_TIMES, RODADAS } = require('../../utils/times');
const { verificarPartidaJaImportada, calcularPartida, gravarPartida } = require('../../firegamesService');

// Quanto tempo o preview (botões Confirmar/Cancelar) fica válido antes de expirar sem gravar
// nada. Ver docs/adr/0002-importar-partida-preview-antes-de-gravar.md
const CONFIRMACAO_TTL_MS = 10 * 60 * 1000;

const MAPAS = ['de_mirage', 'de_dust2', 'de_inferno', 'de_anubis', 'de_ancient', 'de_cache', 'de_nuke'];

module.exports = {
  // exigeRegistro fica no default (true) -- 'importar-partida' não estava em
  // comandosLiberados no legado, então já exigia cadastro antes desta migração.

  data: new SlashCommandBuilder()
    .setName('importar-partida')
    .setDescription('[Owner/Directors] Puxa o CSV do MatchZy via API e atualiza os Elos e Stats')
    // Esconde da lista de comandos de quem não tem Administrador (Owner/Directors/Founders/Trupe
    // já têm essa permissão -- ver utils/permissions.js). A checagem de verdade continua sendo
    // ehAdministrador() no handler; isso aqui só evita poluir a lista de quem não pode usar.
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(option =>
      option.setName('id')
        .setDescription('ID da Partida (MatchZy)')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('servidor')
        .setDescription('Servidor de origem')
        .setRequired(true)
        .addChoices(
          { name: 'Servidor 1', value: process.env.SERVER_ID_1 || 'servidor_1' },
          { name: 'Servidor 2', value: process.env.SERVER_ID_2 || 'servidor_2' },
          { name: 'Servidor 3', value: process.env.SERVER_ID_3 || 'servidor_3' },
          { name: 'Servidor 4', value: process.env.SERVER_ID_4 || 'servidor_4' },
        )
    )
    .addStringOption(option =>
      option.setName('mapa')
        .setDescription('Mapa jogado')
        .setRequired(true)
        .addChoices(...MAPAS.map(m => ({ name: m, value: m })))
    )
    .addStringOption(option =>
      option.setName('mix_id')
        .setDescription('Identificador do dia de mix (ex: 2026-08-18) -- agrupa as partidas no /mix-info')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('rodada')
        .setDescription('Fase do mix day')
        .setRequired(true)
        .addChoices(...RODADAS.map(r => ({ name: r, value: r })))
    )
    .addStringOption(option =>
      option.setName('cor_time_a')
        .setDescription('Nome/cor do Time A')
        .setRequired(true)
        .addChoices(...CORES_TIMES.map(c => ({ name: c, value: c })))
    )
    .addStringOption(option =>
      option.setName('cor_time_b')
        .setDescription('Nome/cor do Time B')
        .setRequired(true)
        .addChoices(...CORES_TIMES.map(c => ({ name: c, value: c })))
    )
    .addIntegerOption(option =>
      option.setName('placar_a')
        .setDescription('Placar Time A (padrão: 13)')
        .setRequired(false)
    )
    .addIntegerOption(option =>
      option.setName('placar_b')
        .setDescription('Placar Time B (padrão: 0)')
        .setRequired(false)
    ),

  // Comando autocontido -- desde que os campos couberam em opções em vez de modal (ver
  // docs/adr/0005-times-com-nome-de-cor-e-mix-id.md), não depende mais de
  // legacy/interactionRouter.js. O preview com botões Confirmar/Cancelar usa um
  // MessageComponentCollector local, sem precisar de loader de componentes.
  async execute(interaction) {
    if (!(await ehAdministrador(interaction))) {
      return await interaction.reply({
        content: '<:trupe_erro:1536410911617843322> Apenas membros com o cargo **Owner** ou **Directors** podem usar este comando!',
        ephemeral: true
      });
    }

    const idPartida = interaction.options.getString('id').trim();
    const servidorId = interaction.options.getString('servidor');
    const mapa = interaction.options.getString('mapa');
    const mixId = interaction.options.getString('mix_id').trim();
    const rodada = interaction.options.getString('rodada');
    const corTimeA = interaction.options.getString('cor_time_a');
    const corTimeB = interaction.options.getString('cor_time_b');
    const scoreA = interaction.options.getInteger('placar_a') ?? 13;
    const scoreB = interaction.options.getInteger('placar_b') ?? 0;

    if (corTimeA === corTimeB) {
      return await interaction.reply({
        content: '<:trupe_erro:1536410911617843322> **cor_time_a** e **cor_time_b** não podem ser a mesma cor.',
        ephemeral: true
      });
    }

    await interaction.deferReply();

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
      const pending = await calcularPartida(idPartida, servidorId, mapa, doc, scoreA, scoreB, null, mixId, rodada, corTimeA, corTimeB);

      const listaTimeA = pending.nomesTimeA.length > 0 ? pending.nomesTimeA.join(', ') : 'Sem jogadores';
      const listaTimeB = pending.nomesTimeB.length > 0 ? pending.nomesTimeB.join(', ') : 'Sem jogadores';

      const previewContent =
        `📋 **Pré-visualização da Partida #${idPartida}** (${rotuloServidor(servidorId)} — ${mapa})\n` +
        `🗓️ **Mix**: ${mixId} • **Rodada**: ${rodada}\n\n` +
        `**${corTimeA} (${scoreA})**: ${listaTimeA}\n` +
        `**${corTimeB} (${scoreB})**: ${listaTimeB}\n` +
        `🏆 **Vencedor**: ${pending.teamWinnerCor}\n\n` +
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
        time: CONFIRMACAO_TTL_MS
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
              `**${corTimeA} (${scoreA})**: ${listaTimeA}\n` +
              `**${corTimeB} (${scoreB})**: ${listaTimeB}\n` +
              `🏆 **Vencedor**: ${pending.teamWinnerCor}`,
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
  },
};
