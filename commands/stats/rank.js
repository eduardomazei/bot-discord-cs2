const { SlashCommandBuilder } = require('discord.js');
const { getSheet } = require('../../utils/sheets');
const { buildContainer, componentsV2Payload, MessageFlags } = require('../../utils/containers');
const { CORES } = require('../../utils/colors');
const { RANKS, obterRank, obterProximoRank } = require('../../utils/ranks');

// Discord não deixa desenhar gradiente/forma customizada no texto de um embed -- só texto,
// emoji e imagem anexada. A barra de progresso é montada concatenando emoji customizado
// "cheio"/"vazio" como texto, em vez de tentar desenhar algo.
const BARRA_CHEIA = '<:trupe_barra_cheia:1540077730920534016>';
const BARRA_VAZIA = '<:trupe_barra_vazia:1540077746204442777>';
const AQUI = '<:trupe_aqui_mazei:1540075545948328036>';

// Barra de progresso em emoji (10 segmentos) até o próximo rank.
function barraProgresso(percentual) {
  const preenchidos = Math.round((percentual / 100) * 10);
  return BARRA_CHEIA.repeat(preenchidos) + BARRA_VAZIA.repeat(10 - preenchidos);
}

module.exports = {
  // exigeRegistro fica no default (true) -- mesma trava dos outros comandos de stats.

  data: new SlashCommandBuilder()
    .setName('rank')
    .setDescription('Mostra seu rank atual, o progresso pro próximo e a escada completa')
    .addUserOption(opt =>
      opt.setName('usuario')
        .setDescription('Jogador para consultar o rank')
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

      const pRow = rows.find(r => r.get('discord_id') === targetUser.id);

      if (!pRow) {
        return await interaction.editReply(componentsV2Payload(
          buildContainer({
            cor: CORES.ERRO,
            titulo: 'Jogador não cadastrado',
            corpo: `<:trupe_erro:1536410911617843322> O jogador **${displayName}** ainda não possui cadastro via \`/registrar\`.`,
          })
        ));
      }

      const elo = parseInt(pRow.get('elo') || 1000);
      const rankAtual = obterRank(elo);
      const proximoRank = obterProximoRank(elo);

      let blocoProgresso;
      if (proximoRank) {
        const faltam = proximoRank.min - elo;
        const percentual = Math.min(100, Math.max(0,
          ((elo - rankAtual.min) / (proximoRank.min - rankAtual.min)) * 100
        ));
        blocoProgresso = [
          `📈 **Progresso pro próximo rank (${proximoRank.emoji} ${proximoRank.nome})**`,
          `${barraProgresso(percentual)} ${percentual.toFixed(0)}% — faltam **${faltam}** pts`,
        ].join('\n');
      } else {
        blocoProgresso = '<a:trupe_trofeu:1536412945339129857> **Rank máximo!** Você já está no topo da escada.';
      }

      const escada = RANKS.map(r => {
        const linha = `${r.emoji} **${r.nome}** — ${r.min}+ Elo`;
        return r.nome === rankAtual.nome ? `${AQUI} ${linha} *(você está aqui)*` : linha;
      }).join('\n');

      const corpo = [
        `<:trupe_elo_up:1536410866709176492> **Elo Atual**: ${elo} pts`,
        `${rankAtual.emoji} **Rank Atual**: ${rankAtual.nome}`,
        '',
        blocoProgresso,
        '',
        `<:trupe_rank_mazei:1540075280838693075> **Escada de Ranks**`,
        escada,
      ].join('\n');

      return await interaction.editReply(componentsV2Payload(
        buildContainer({
          cor: CORES.INFO,
          titulo: `<:trupe_rank_mazei:1540075280838693075> Rank — ${displayName}`,
          corpo,
          thumbnailUrl: targetUser.displayAvatarURL({ dynamic: true }),
          rodape: 'Elo varia pelo seu KD na partida: Vitória +10~40 | Derrota -5~30',
        })
      ));
    } catch (err) {
      console.error('Erro no /rank:', err);
      return await interaction.editReply(componentsV2Payload(
        buildContainer({ cor: CORES.AVISO, titulo: 'Erro', corpo: '<:trupe_aviso:1536410370829328434> Erro ao consultar o rank.' })
      ));
    }
  },
};
