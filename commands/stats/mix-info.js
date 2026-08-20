const { SlashCommandBuilder } = require('discord.js');
const { getSheet } = require('../../utils/sheets');
const { buildContainer, componentsV2Payload, MessageFlags } = require('../../utils/containers');
const { CORES } = require('../../utils/colors');
const { RODADAS, EMOJI_CORES, EMOJI_RODADAS } = require('../../utils/times');

module.exports = {
  // exigeRegistro fica no default (true) -- mesma trava dos outros comandos de stats.

  data: new SlashCommandBuilder()
    .setName('mix-info')
    .setDescription('Mostra como foi o mix de um dia: rodadas, confrontos e placares')
    .addStringOption(option =>
      option.setName('mix_id')
        .setDescription('Identificador do mix day (deixe em branco para ver o mais recente)')
        .setRequired(false)
    ),

  async execute(interaction) {
    // A flag IsComponentsV2 precisa ser declarada já aqui -- não dá pra adicionar depois via editReply.
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

    try {
      const sheetPartidas = await getSheet('Partidas');
      const rows = await sheetPartidas.getRows();
      // Só partidas importadas depois do docs/adr/0005 (com mix_id preenchido) entram aqui —
      // partidas antigas não têm essa coluna e não têm como ser agrupadas num dia.
      const comMixId = rows.filter(r => (r.get('mix_id') || '').trim() !== '');

      if (comMixId.length === 0) {
        return await interaction.editReply(componentsV2Payload(
          buildContainer({
            cor: CORES.AVISO,
            titulo: 'Sem mix registrado',
            corpo: '<:trupe_aviso:1536410370829328434> Nenhuma partida foi importada com **mix_id** ainda. Preencha esse campo em `/importar-partida` pra ela aparecer aqui.',
          })
        ));
      }

      // Sem mix_id informado -> pega o mais recente (última linha com mix_id preenchido).
      const mixIdBuscado = interaction.options.getString('mix_id')?.trim() || comMixId[comMixId.length - 1].get('mix_id');
      const partidasDoMix = comMixId.filter(r => r.get('mix_id') === mixIdBuscado);

      if (partidasDoMix.length === 0) {
        return await interaction.editReply(componentsV2Payload(
          buildContainer({
            cor: CORES.ERRO,
            titulo: 'Não encontrado',
            corpo: `<:trupe_erro:1536410911617843322> Nenhuma partida encontrada com **mix_id** \`${mixIdBuscado}\`.`,
          })
        ));
      }

      // Agrupa por rodada. A ordem de exibição é sempre RODADAS (Aquecimento -> Final),
      // não a ordem em que os admins rodaram /importar-partida.
      const porRodada = new Map();
      for (const partida of partidasDoMix) {
        const rodada = partida.get('rodada') || 'Outras';
        if (!porRodada.has(rodada)) porRodada.set(rodada, []);
        porRodada.get(rodada).push(partida);
      }
      const ordemExibicao = [...RODADAS, ...[...porRodada.keys()].filter(r => !RODADAS.includes(r))];

      // Monta "🔴 Vermelho" (com emoji de cor quando reconhecida -- ver EMOJI_CORES em utils/times.js;
      // partidas gravadas antes do ADR 0005 não têm team_a_cor/team_b_cor preenchido, aí cai no rótulo
      // genérico sem emoji) e deixa o placar de quem venceu em negrito pra saltar aos olhos na leitura
      // rápida. team_winner grava o literal 'Time A'/'Time B' -- mesma leitura usada em partida-info.js.
      function nomeComEmoji(cor, generico) {
        const nome = cor || generico;
        return EMOJI_CORES[nome] ? `${EMOJI_CORES[nome]} ${nome}` : nome;
      }
      function confrontoFormatado(p) {
        const corA = p.get('team_a_cor') || 'Time A';
        const corB = p.get('team_b_cor') || 'Time B';
        const scoreA = p.get('score_a') || 0;
        const scoreB = p.get('score_b') || 0;
        const vencedor = p.get('team_winner') || '';
        const venceuA = vencedor.includes('A');
        const venceuB = vencedor.includes('B');
        const placarA = venceuA ? `**${scoreA}**` : `${scoreA}`;
        const placarB = venceuB ? `**${scoreB}**` : `${scoreB}`;
        return `${nomeComEmoji(corA, 'Time A')} ${placarA} x ${placarB} ${nomeComEmoji(corB, 'Time B')}  —  #${p.get('matchid')} · ${p.get('map') || 'N/I'}`;
      }

      const blocos = [];

      // Campeão do dia em destaque no topo -- só quando dá pra identificar com confiança (rodada
      // "Final" com um único confronto e vencedor reconhecido); em qualquer outro caso (mix ainda em
      // andamento, mais de uma "final", ou dado antigo sem team_winner/cor) omite em vez de arriscar
      // mostrar um campeão errado.
      const finais = porRodada.get('Final') || [];
      if (finais.length === 1) {
        const final = finais[0];
        const vencedor = final.get('team_winner') || '';
        const corCampeao = vencedor.includes('A') ? final.get('team_a_cor')
          : vencedor.includes('B') ? final.get('team_b_cor')
          : null;
        if (corCampeao) {
          blocos.push(`<a:trupe_trofeu:1536412945339129857> **Campeão do dia:** ${nomeComEmoji(corCampeao)}`);
        }
      }

      for (const rodada of ordemExibicao) {
        const partidasRodada = porRodada.get(rodada);
        if (!partidasRodada || partidasRodada.length === 0) continue;

        const linhas = partidasRodada.map(confrontoFormatado).join('\n');
        const icone = EMOJI_RODADAS[rodada] || '▫️';
        blocos.push(`### ${icone} ${rodada}\n${linhas}`);
      }

      return await interaction.editReply(componentsV2Payload(
        buildContainer({
          cor: CORES.INFO,
          titulo: `<:trupe_teia:1536412408203976888> Mix — ${mixIdBuscado}`,
          corpo: blocos.join('\n\n'),
          rodape: 'Mix Trupe CS2 • Resumo do dia • Use /partida-info #id pra ver detalhes de uma partida',
        })
      ));
    } catch (error) {
      console.error('Erro no /mix-info:', error);
      await interaction.editReply(componentsV2Payload(
        buildContainer({ cor: CORES.AVISO, titulo: 'Erro', corpo: '<:trupe_aviso:1536410370829328434> Erro ao consultar os dados do mix.' })
      ));
    }
  },
};
