const { SlashCommandBuilder } = require('discord.js');
const { getSheet } = require('../../utils/sheets');
const { buildContainer, componentsV2Payload, MessageFlags } = require('../../utils/containers');
const { CORES } = require('../../utils/colors');

module.exports = {
  // exigeRegistro fica no default (true) -- 'hall-da-fama' não estava em
  // comandosLiberados no legado, então já exigia cadastro antes desta migração.

  data: new SlashCommandBuilder()
    .setName('hall-da-fama')
    .setDescription('Exibe os recordes históricos da comunidade (Maior ADR, Kills, Winrate)'),

  async execute(interaction) {
    // A flag IsComponentsV2 precisa ser declarada já aqui -- não dá pra adicionar depois via editReply.
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

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

      const corpo = [
        '💣 **Maior Dano / ADR em 1 Partida**',
        maiorADR.val > 0 ? `<:trupe_coroa_mazei:1537477117686718574> **${maiorADR.nick}** — **${maiorADR.val.toFixed(1)}** ADR *(${maiorADR.mapa})*` : 'N/A',
        '',
        '<:trupe_kills:1536411018765402212> **Maior Número de Kills em 1 Partida**',
        maiorKills.val > 0 ? `<:trupe_coroa_mazei:1537477117686718574> **${maiorKills.nick}** — **${maiorKills.val}** Kills *(${maiorKills.mapa})*` : 'N/A',
        '',
        '<:trupe_coroa_mazei:1537477117686718574> **Maior Winrate do Servidor (mín. 5 jogos)**',
        maiorWinrate.val > 0 ? `<:trupe_coroa_mazei:1537477117686718574> **${maiorWinrate.nick}** — **${maiorWinrate.val.toFixed(0)}%** *(${maiorWinrate.partidas} jogos)*` : 'N/A',
      ].join('\n');

      return await interaction.editReply(componentsV2Payload(
        buildContainer({
          cor: CORES.AVISO,
          titulo: '<:trupe_teia:1536412408203976888> Hall da Fama — Mix Trupe CS2',
          corpo,
          rodape: 'Recordes históricos gravados via Google Sheets',
        })
      ));
    } catch (err) {
      console.error('Erro no /hall-da-fama:', err);
      return await interaction.editReply(componentsV2Payload(
        buildContainer({ cor: CORES.AVISO, titulo: 'Erro', corpo: '<:trupe_aviso:1536410370829328434> Erro ao calcular estatísticas do Hall da Fama.' })
      ));
    }
  },
};
