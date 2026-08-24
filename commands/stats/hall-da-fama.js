const { SlashCommandBuilder } = require('discord.js');
const { getSheet } = require('../../utils/sheets');
const { buildContainer, componentsV2Payload, MessageFlags } = require('../../utils/containers');
const { CORES } = require('../../utils/colors');
const { encontrarPartida, totalRoundsDaPartida } = require('../../utils/partidas');

// Menção Discord quando o jogador está cadastrado, "nick ❔" caso contrário -- mesmo padrão do
// /partida-info e /stats-mapa. Diferente do elenco de Partidas (docs/adr/0001), o discord_id de
// Stats_Partidas é gravado uma vez no import e não é reavaliado depois -- então alguém que se
// registra DEPOIS de bater um recorde ainda aparece com ❔ aqui até que o dado seja reimportado.
function mencao(discordId, nick) {
  return discordId && discordId !== 'NÃO_REGISTRADO' ? `<@${discordId}>` : `${nick} ❔`;
}

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
      const sheetPartidas = await getSheet('Partidas');

      const rowsStats = await sheetStats.getRows();
      const rowsJogadores = await sheetJogadores.getRows();
      const rowsPartidas = await sheetPartidas.getRows();

      let maiorADR = { discordId: null, nick: 'N/A', val: 0, mapa: 'N/A' };
      let maiorKills = { discordId: null, nick: 'N/A', val: 0, mapa: 'N/A' };

      rowsStats.forEach(r => {
        const damage = parseFloat(r.get('damage') || 0);
        // ADR de verdade (rounds reais da partida), não um número fixo de 24 -- ver utils/partidas.js.
        const partida = encontrarPartida(rowsPartidas, r.get('matchid'), r.get('server_id'));
        const adr = damage / totalRoundsDaPartida(partida);
        const kills = parseInt(r.get('kills') || 0);
        const discordId = r.get('discord_id');
        const nick = r.get('nick_discord') || 'Jogador';
        const mapa = r.get('map') || 'Geral';

        if (adr > maiorADR.val) maiorADR = { discordId, nick, val: adr, mapa };
        if (kills > maiorKills.val) maiorKills = { discordId, nick, val: kills, mapa };
      });

      // Jogadores só tem gente registrada -- discord_id sempre existe, sem caso de ❔ aqui.
      let maiorWinrate = { discordId: null, nick: 'N/A', val: 0, partidas: 0 };
      rowsJogadores.forEach(r => {
        const partidas = parseInt(r.get('matchs') || 0);
        const vitorias = parseInt(r.get('wins') || 0);
        if (partidas >= 5) {
          const wr = (vitorias / partidas) * 100;
          if (wr > maiorWinrate.val) {
            maiorWinrate = { discordId: r.get('discord_id'), nick: r.get('discord_nick') || 'Jogador', val: wr, partidas };
          }
        }
      });

      const corpo = [
        '💣 **Maior Dano / ADR em 1 Partida**',
        maiorADR.val > 0 ? `<:trupe_coroa_mazei:1537477117686718574> ${mencao(maiorADR.discordId, maiorADR.nick)} — **${maiorADR.val.toFixed(1)}** ADR *(${maiorADR.mapa})*` : 'N/A',
        '',
        '<:trupe_kills_mazei:1536411018765402212> **Maior Número de Kills em 1 Partida**',
        maiorKills.val > 0 ? `<:trupe_coroa_mazei:1537477117686718574> ${mencao(maiorKills.discordId, maiorKills.nick)} — **${maiorKills.val}** Kills *(${maiorKills.mapa})*` : 'N/A',
        '',
        '<:trupe_trofeu_mazei:1536412981166997624> **Maior Winrate do Servidor (mín. 5 jogos)**',
        maiorWinrate.val > 0 ? `<:trupe_coroa_mazei:1537477117686718574> ${mencao(maiorWinrate.discordId, maiorWinrate.nick)} — **${maiorWinrate.val.toFixed(0)}%** *(${maiorWinrate.partidas} jogos)*` : 'N/A',
      ].join('\n');

      const temNaoCadastrado = [maiorADR, maiorKills].some(r => !r.discordId || r.discordId === 'NÃO_REGISTRADO');

      return await interaction.editReply(componentsV2Payload(
        buildContainer({
          cor: CORES.AVISO,
          titulo: '<:trupe_coroa_mazei:1537477117686718574> Hall da Fama — Mix Trupe CS2',
          corpo,
          rodape: temNaoCadastrado
            ? 'Recordes históricos • ❔ = jogador ainda não fez /registrar'
            : 'Recordes históricos gravados via Google Sheets',
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
