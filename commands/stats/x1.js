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

      const corpo = [
        `**${interaction.user.username}** VS **${adv.username}**`,
        '',
        `🤝 **Partidas no Mesmo Time**: ${juntos}`,
        `⚔️ **Partidas como Adversários**: ${contra}`,
        `<a:trupe_trofeu:1536412945339129857> **Placar de Vitórias (Contras)**: **${interaction.user.username}** \`${vitoriasUser}\` x \`${vitoriasAdv}\` **${adv.username}**`,
      ].join('\n');

      return await interaction.editReply(componentsV2Payload(
        buildContainer({ cor: CORES.ERRO, titulo: '<:trupe_teia:1536412408203976888> Confronto Direto (Head-to-Head)', corpo })
      ));
    } catch (err) {
      console.error('Erro no /x1:', err);
      return await interaction.editReply(componentsV2Payload(
        buildContainer({ cor: CORES.AVISO, titulo: 'Erro', corpo: '<:trupe_aviso:1536410370829328434> Erro ao calcular confronto direto.' })
      ));
    }
  },
};
