const { SlashCommandBuilder } = require('discord.js');
const { getSheet } = require('../../utils/sheets');
const { buildContainer, componentsV2Payload, MessageFlags } = require('../../utils/containers');
const { CORES } = require('../../utils/colors');
const { obterSteamIdPorDiscordId } = require('../../services/registroService');
const { interpretarCelulaElenco, timeContemJogador } = require('../../utils/elenco');

module.exports = {
  // exigeRegistro fica no default (true) -- 'x1' não estava em comandosLiberados
  // no legado, então já exigia cadastro antes desta migração.

  data: new SlashCommandBuilder()
    .setName('x1')
    .setDescription('Compara o histórico head-to-head entre você e outro jogador')
    .addUserOption(opt =>
      opt.setName('adversario')
        .setDescription('Selecione o jogador para comparar estatísticas')
        .setRequired(true)
    ),

  async execute(interaction) {
    // A flag IsComponentsV2 precisa ser declarada já aqui -- não dá pra adicionar depois via editReply.
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

    try {
      const adv = interaction.options.getUser('adversario');

      if (adv.id === interaction.user.id) {
        return await interaction.editReply(componentsV2Payload(
          buildContainer({ cor: CORES.AVISO, titulo: 'Confronto inválido', corpo: '<:trupe_aviso:1536410370829328434> Escolha outro jogador — não dá pra comparar consigo mesmo.' })
        ));
      }

      const sheetPartidas = await getSheet('Partidas');
      const rows = await sheetPartidas.getRows();

      // Precisa do steamid64 de cada um pra reconhecer entradas no formato novo
      // (ver interpretarCelulaElenco) — entradas no formato antigo continuam
      // reconhecidas direto pelo discord_id, sem precisar disso.
      const steamIdUser = await obterSteamIdPorDiscordId(interaction.user.id);
      const steamIdAdv = await obterSteamIdPorDiscordId(adv.id);

      let juntos = 0;
      let contra = 0;
      let vitoriasUser = 0;
      let vitoriasAdv = 0;

      rows.forEach(r => {
        const timeA = interpretarCelulaElenco(r.get('team_a_ids'));
        const timeB = interpretarCelulaElenco(r.get('team_b_ids'));
        const vencedor = r.get('team_winner') || '';

        const userEmA = timeContemJogador(timeA, interaction.user.id, steamIdUser);
        const userEmB = timeContemJogador(timeB, interaction.user.id, steamIdUser);
        const advEmA = timeContemJogador(timeA, adv.id, steamIdAdv);
        const advEmB = timeContemJogador(timeB, adv.id, steamIdAdv);

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

      // Nomes de exibição (apelido do servidor) em vez do username cru -- e menção clicável no
      // placar, mesmo padrão de resolução usado em /elo, /player e no elenco do /partida-info.
      const memberUser = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
      const memberAdv = await interaction.guild.members.fetch(adv.id).catch(() => null);
      const nomeUser = memberUser ? memberUser.displayName : interaction.user.username;
      const nomeAdv = memberAdv ? memberAdv.displayName : adv.username;

      // Negrito em quem está na frente no confronto direto -- mesma ideia do placar em negrito
      // do /mix-info (confrontoFormatado). Sem negrito nenhum lado em caso de empate.
      const placarUser = vitoriasUser > vitoriasAdv ? `**${vitoriasUser}**` : `${vitoriasUser}`;
      const placarAdv = vitoriasAdv > vitoriasUser ? `**${vitoriasAdv}**` : `${vitoriasAdv}`;

      const linhaPlacar = contra > 0
        ? `<@${interaction.user.id}> \`${placarUser}\` x \`${placarAdv}\` <@${adv.id}>`
        : '*Ainda não jogaram um contra o outro.*';

      const corpo = [
        `<:trupe_partidas_mazei:1536591014809178172> **Partidas no Mesmo Time**: ${juntos}`,
        `⚔️ **Partidas como Adversários**: ${contra}`,
        '',
        `<a:trupe_trofeu:1536412945339129857> **Placar de Confrontos Diretos**`,
        linhaPlacar,
      ].join('\n');

      // Cor dinâmica pelo lado de quem pediu o comando -- verde se está na frente, amarelo se
      // está atrás, neutro em empate ou sem confrontos ainda (mesma ideia da cor por vencedor
      // do /partida-info, ver CLAUDE.md).
      const cor = contra === 0 || vitoriasUser === vitoriasAdv
        ? CORES.NEUTRO
        : (vitoriasUser > vitoriasAdv ? CORES.SUCESSO : CORES.AVISO);

      return await interaction.editReply(componentsV2Payload(
        buildContainer({
          cor,
          titulo: `<:trupe_teia:1536412408203976888> Confronto Direto — ${nomeUser} vs ${nomeAdv}`,
          corpo,
          rodape: 'Mix Trupe CS2 • Head-to-Head',
        })
      ));
    } catch (err) {
      console.error('Erro no /x1:', err);
      return await interaction.editReply(componentsV2Payload(
        buildContainer({ cor: CORES.AVISO, titulo: 'Erro', corpo: '<:trupe_aviso:1536410370829328434> Erro ao calcular confronto direto.' })
      ));
    }
  },
};
