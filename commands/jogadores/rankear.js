const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const { ehAdministrador } = require('../../utils/permissions');
const { getSheet } = require('../../utils/sheets');
const { CORES } = require('../../utils/colors');
const {
  RANKS, obterRank, TAG_POR_RANK, ELO_MEIO_FAIXA, montarNick, nomeLimpo,
} = require('../../utils/ranks');
const { invalidarRegistroCache } = require('../../services/registroService');
const { sincronizarRankNick } = require('../../services/supabaseSyncService');

const LETRAS = RANKS.map(r => r.nome); // ['E','D','C','B','A','S','SS']

module.exports = {
  // exigeRegistro fica no default (true) -- comando de administração.

  data: new SlashCommandBuilder()
    .setName('rankear')
    .setDescription('[Owner/Directors] Define o rank de um jogador (ajusta o Elo e o apelido)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(option =>
      option.setName('jogador')
        .setDescription('Jogador a rankear')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('rank')
        .setDescription('Rank a atribuir')
        .setRequired(true)
        .addChoices(...LETRAS.map(l => ({ name: l, value: l })))
    ),

  async execute(interaction) {
    if (!(await ehAdministrador(interaction))) {
      return await interaction.reply({
        content: '<:trupe_erro:1536410911617843322> Apenas membros com o cargo **Owner** ou **Directors** podem rankear jogadores!',
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    try {
      const targetUser = interaction.options.getUser('jogador');
      const rankAlvo = interaction.options.getString('rank');
      const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);

      const sheet = await getSheet('Jogadores');
      const rows = await sheet.getRows();
      const row = rows.find(r => r.get('discord_id') === targetUser.id);

      if (!row) {
        return await interaction.editReply(
          `<:trupe_erro:1536410911617843322> <@${targetUser.id}> ainda não tem cadastro — peça pra registrar com \`/registrar\` antes de rankear.`
        );
      }

      const eloAtual = parseInt(row.get('elo') || 1000, 10);
      const rankAtual = obterRank(eloAtual).nome;

      // Se já está na faixa do rank alvo, não mexe no Elo (evita cutucar o Elo de carreira
      // à toa) -- só reconcilia a tag. Senão, joga pro meio da faixa do rank escolhido.
      const mesmaFaixa = rankAtual === rankAlvo;
      const novoElo = mesmaFaixa ? eloAtual : ELO_MEIO_FAIXA[rankAlvo];

      // Nome limpo: prioriza a coluna `nome`; se ainda vazia, tira a tag do apelido atual.
      const nome = (row.get('nome') || '').trim()
        || nomeLimpo(member ? member.displayName : targetUser.username)
        || targetUser.username;

      const nickNovo = montarNick(nome, TAG_POR_RANK[rankAlvo]);

      row.set('nome', nome);
      row.set('rank_tag', rankAlvo);
      row.set('discord_nick', nickNovo);
      if (!mesmaFaixa) row.set('elo', String(novoElo));
      await row.save();

      invalidarRegistroCache();

      // Dual-write pro Supabase (best-effort, nunca derruba o comando).
      await sincronizarRankNick({
        discordId: targetUser.id,
        nome,
        rankTag: rankAlvo,
        discordNick: nickNovo,
        elo: novoElo,
      });

      // Renomeia no Discord -- separado do save da planilha: se falhar aqui, a planilha já
      // está certa e o próximo /importar-partida (ou um novo /rankear) reconcilia.
      let avisoNick = '';
      if (!member) {
        avisoNick = '\n<:trupe_aviso:1536410370829328434> Não está no servidor agora — apelido não alterado.';
      } else if (!member.manageable) {
        avisoNick = '\n<:trupe_aviso:1536410370829328434> Não consegui alterar o apelido (dono do servidor ou cargo acima do bot).';
      } else {
        try {
          await member.setNickname(nickNovo, `Rankeado como ${rankAlvo} por ${interaction.user.tag}`);
        } catch (err) {
          console.error('Erro ao renomear no /rankear:', err);
          avisoNick = '\n<:trupe_aviso:1536410370829328434> Planilha atualizada, mas não consegui alterar o apelido no Discord — confira a hierarquia de cargos.';
        }
      }

      const embed = new EmbedBuilder()
        .setColor(CORES.SUCESSO)
        .setTitle(`<:trupe_rank_mazei:1540075280838693075> Rank definido — ${nome}`)
        .setDescription(`<@${targetUser.id}> agora é **${rankAlvo}**.${avisoNick}`)
        .addFields(
          { name: 'Rank', value: rankAtual === rankAlvo ? `**${rankAlvo}** (mantido)` : `${rankAtual} → **${rankAlvo}**`, inline: true },
          { name: 'Elo', value: mesmaFaixa ? `**${eloAtual}** (mantido)` : `${eloAtual} → **${novoElo}**`, inline: true },
          { name: 'Apelido', value: `\`${nickNovo}\``, inline: false },
        )
        .setFooter({ text: 'A partir daqui o rank acompanha o Elo automaticamente a cada mix.' });

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error('Erro ao rankear:', error);
      await interaction.editReply('<:trupe_aviso:1536410370829328434> Erro ao rankear o jogador.');
    }
  },
};
