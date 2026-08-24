const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { ehAdministrador } = require('../../utils/permissions');
const { getSheet } = require('../../utils/sheets');
const { CORES } = require('../../utils/colors');
const { PONTOS_POR_PUNICAO } = require('../../utils/advertencias');
const { enviarNotificacaoDM } = require('../../services/notificacoesService');
const { BANNERS } = require('../../utils/banners');

module.exports = {
  // exigeRegistro fica no default (true) -- 'desadvertir' não estava em
  // comandosLiberados no legado, então já exigia cadastro antes desta migração.

  data: new SlashCommandBuilder()
    .setName('desadvertir')
    .setDescription('[Owner/Directors] Remove advertências e libera punições de um jogador')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(option =>
      option.setName('jogador')
        .setDescription('Jogador')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName('pontos')
        .setDescription('Quantos pontos remover (padrão: remove todos e libera qualquer punição)')
        .setRequired(false)
    ),

  async execute(interaction) {
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

      // Título de embed não renderiza menção (só description/fields renderizam <@id> como link)
      // -- usa o apelido do servidor em vez do username cru, mesmo padrão de utils/advertencias.js.
      const targetMember = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
      const displayName = targetMember ? targetMember.displayName : targetUser.username;

      const embed = new EmbedBuilder()
        .setTitle(`<:trupe_teia:1536412408203976888> Advertências Atualizadas — ${displayName}`)
        .setColor(CORES.SUCESSO)
        .addFields(
          { name: '👤 Jogador', value: `<@${targetUser.id}>`, inline: true },
          { name: '<:trupe_aviso:1536410370829328434> Pontos Restantes', value: `**${pontosDepois}** pts`, inline: true },
          { name: '🔓 Punições Ativas', value: punicoesDepois > 0 ? `${punicoesDepois}` : 'Nenhuma — jogador liberado', inline: true }
        );

      await interaction.editReply({ embeds: [embed] });

      await enviarNotificacaoDM(interaction.client, targetUser.id, {
        bannerKey: BANNERS.DESADVERTIR,
        cor: CORES.SUCESSO,
        titulo: '<:trupe_sucesso:1536412279778574356> Sua advertência foi retirada',
        corpo: punicoesDepois > 0
          ? `Você ainda tem **${pontosDepois} pts** de advertência e **${punicoesDepois}** punição(ões) ativa(s).`
          : `Você agora está com **${pontosDepois} pts** de advertência, sem nenhuma punição ativa.`,
      });
    } catch (error) {
      console.error('Erro ao desadvertir:', error);
      await interaction.editReply('<:trupe_aviso:1536410370829328434> Erro ao atualizar advertências.');
    }
  },
};
