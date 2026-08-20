const { SlashCommandBuilder } = require('discord.js');
const { getSheet } = require('../../utils/sheets');
const { buildContainer, componentsV2Payload, MessageFlags } = require('../../utils/containers');
const { CORES } = require('../../utils/colors');
const { rotuloServidor } = require('../../utils/servidores');
const { interpretarCelulaElenco, resolverElencoParaExibicao } = require('../../utils/elenco');

// Converte "DD/MM/AAAA, HH:mm:ss" (formato gravado via toLocaleString('pt-BR') em
// firegamesService.js) de volta pra Date, pra alimentar o timestamp nativo do embed. Retorna
// null se o texto não bater com o formato esperado. Único consumidor: este comando.
function parseDataPtBr(dataStr) {
  const m = (dataStr || '').match(/^(\d{2})\/(\d{2})\/(\d{4}),?\s*(\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const [, dd, mm, yyyy, hh, min, ss] = m;
  const data = new Date(`${yyyy}-${mm}-${dd}T${hh}:${min}:${ss}`);
  return Number.isNaN(data.getTime()) ? null : data;
}

module.exports = {
  // exigeRegistro fica no default (true) -- 'partida-info' não estava em
  // comandosLiberados no legado, então já exigia cadastro antes desta migração.

  data: new SlashCommandBuilder()
    .setName('partida-info')
    .setDescription('Exibe as informações e placar de uma partida específica')
    .addStringOption(option =>
      option.setName('id')
        .setDescription('ID da Partida (deixe em branco para ver a última)')
        .setRequired(false)
    )
    .addStringOption(option =>
      option.setName('servidor')
        .setDescription('Servidor de origem — use se o ID se repetir entre servidores diferentes')
        .setRequired(false)
        .addChoices(
          { name: 'Servidor 1', value: process.env.SERVER_ID_1 || 'servidor_1' },
          { name: 'Servidor 2', value: process.env.SERVER_ID_2 || 'servidor_2' },
          { name: 'Servidor 3', value: process.env.SERVER_ID_3 || 'servidor_3' },
          { name: 'Servidor 4', value: process.env.SERVER_ID_4 || 'servidor_4' },
        )
    ),

  async execute(interaction) {
    // A flag IsComponentsV2 precisa ser declarada já aqui -- não dá pra adicionar depois via editReply.
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

    try {
      const idBuscado = interaction.options.getString('id');
      const servidorBuscado = interaction.options.getString('servidor');
      const sheetPartidas = await getSheet('Partidas');
      const rowsPartidas = await sheetPartidas.getRows();

      if (rowsPartidas.length === 0) {
        return await interaction.editReply(componentsV2Payload(
          buildContainer({ cor: CORES.AVISO, titulo: 'Sem partidas', corpo: '<:trupe_aviso:1536410370829328434> Nenhuma partida encontrada no sistema.' })
        ));
      }

      // matchid sozinho não é único entre servidores (cada servidor tem sua própria numeração
      // do MatchZy) — por isso o filtro por servidor, quando informado, é aplicado junto.
      let candidatos = rowsPartidas;
      if (idBuscado) candidatos = candidatos.filter(r => r.get('matchid') === idBuscado);
      if (servidorBuscado) candidatos = candidatos.filter(r => r.get('server_id') === servidorBuscado);

      let partida;
      if (idBuscado) {
        if (candidatos.length > 1) {
          // Mesmo ID em mais de um servidor e nenhum "servidor" pra desambiguar — lista as
          // opções em vez de chutar uma (podia ser a errada).
          const lista = candidatos
            .map(c => `• \`#${c.get('matchid')}\` — **${rotuloServidor(c.get('server_id'))}** — ${c.get('date') || 'N/I'} (${c.get('map') || 'N/I'})`)
            .join('\n');
          return await interaction.editReply(componentsV2Payload(
            buildContainer({
              cor: CORES.AVISO,
              titulo: 'Vários resultados',
              corpo: `<:trupe_aviso:1536410370829328434> Encontrei **${candidatos.length} partidas** com o ID \`#${idBuscado}\` em servidores diferentes:\n\n${lista}\n\nRode de novo especificando a opção **servidor** pra escolher qual.`,
            })
          ));
        }
        partida = candidatos[0];
        if (!partida) {
          return await interaction.editReply(componentsV2Payload(
            buildContainer({ cor: CORES.ERRO, titulo: 'Não encontrada', corpo: `<:trupe_erro:1536410911617843322> Partida ID \`#${idBuscado}\`${servidorBuscado ? ` no ${rotuloServidor(servidorBuscado)}` : ''} não foi encontrada.` })
          ));
        }
      } else {
        if (candidatos.length === 0) {
          return await interaction.editReply(componentsV2Payload(
            buildContainer({ cor: CORES.ERRO, titulo: 'Não encontrada', corpo: `<:trupe_erro:1536410911617843322> Nenhuma partida encontrada${servidorBuscado ? ` no ${rotuloServidor(servidorBuscado)}` : ''}.` })
          ));
        }
        partida = candidatos[candidatos.length - 1];
      }

      // Elenco resolvido na hora contra a aba Jogadores — ver docs/adr/0001-elenco-partida-resolvido-em-tempo-de-leitura.md
      const entradasA = interpretarCelulaElenco(partida.get('team_a_ids'));
      const entradasB = interpretarCelulaElenco(partida.get('team_b_ids'));
      const linhasTimeA = await resolverElencoParaExibicao(entradasA);
      const linhasTimeB = await resolverElencoParaExibicao(entradasB);

      // Stats individuais dessa partida específica (Stats_Partidas tem 1 linha por jogador,
      // indexada por matchid+server_id — mesmo par usado pra deduplicar em verificarPartidaJaImportada).
      const sheetStats = await getSheet('Stats_Partidas');
      const statsDaPartida = (await sheetStats.getRows()).filter(r =>
        r.get('matchid') === partida.get('matchid') && r.get('server_id') === partida.get('server_id')
      );
      // Casa uma entrada de elenco (steamId no formato novo, discordId no formato antigo — ver
      // utils/elenco.js) com a linha de stats correspondente. steamid64 é sempre gravado em
      // Stats_Partidas independente de registro; discord_id só quando o jogador está cadastrado.
      function statsDoJogador(entrada) {
        return statsDaPartida.find(r =>
          (entrada.steamId && r.get('steamid64') === entrada.steamId) ||
          (entrada.discordId && r.get('discord_id') === entrada.discordId)
        );
      }
      function formatarLinha(linha, entrada, i) {
        const s = statsDoJogador(entrada);
        if (!s) return `**${i + 1}.** ${linha}`;
        const kills = parseInt(s.get('kills') || 0);
        const hs = parseInt(s.get('head_shot_kills') || 0);
        const hsPct = kills > 0 ? Math.round((hs / kills) * 100) : 0;
        return `**${i + 1}.** ${linha} — \`${kills}/${s.get('deaths')}/${s.get('assists')}\` · ${s.get('damage')} dmg · ${hsPct}% HS`;
      }
      // Numerada, no mesmo estilo já usado no painel de presença (construirEmbedPresenca).
      const idsA = linhasTimeA.map((linha, i) => formatarLinha(linha, entradasA[i], i)).join('\n');
      const idsB = linhasTimeB.map((linha, i) => formatarLinha(linha, entradasB[i], i)).join('\n');
      const temNaoCadastrado = [...linhasTimeA, ...linhasTimeB].some(l => l.includes('❔'));

      // Ver docs/adr/0005-times-com-nome-de-cor-e-mix-id.md — partidas importadas antes dessa
      // mudança não têm essas colunas preenchidas; cai pro rótulo genérico nesse caso.
      const corA = partida.get('team_a_cor');
      const corB = partida.get('team_b_cor');
      const labelA = corA || 'Time A';
      const labelB = corB || 'Time B';

      const vencedor = partida.get('team_winner') || '';
      const vencedorTexto = (corA && corB)
        ? (vencedor.includes('A') ? corA : vencedor.includes('B') ? corB : vencedor || 'N/I')
        : (vencedor || 'N/I');
      // Azul se Time A venceu, dourado se Time B venceu (mesmas cores dos ícones de Time A/B do
      // elenco); roxo neutro se não der pra saber (linha antiga sem vencedor reconhecível).
      const corPorVencedor = vencedor.includes('A') ? CORES.INFO : vencedor.includes('B') ? CORES.AVISO : 0x9B59B6;

      // Data/Hora ganha um timestamp nativo do Discord (<t:...:F>, com "há Xh" automático) --
      // Components V2 não tem o .setTimestamp() do embed clássico, então o relógio precisa
      // entrar embutido no próprio texto.
      const dataPartida = parseDataPtBr(partida.get('date'));
      const dataTexto = dataPartida
        ? `<t:${Math.floor(dataPartida.getTime() / 1000)}:F>`
        : (partida.get('date') || 'N/I');

      const corpo = [
        `<:trupe_presenca:1536411530944446546> **Data/Hora**: ${dataTexto}`,
        `<:trupe_mapa:1536413320397979718> **Mapa**: ${partida.get('map') || 'N/I'}`,
        `<a:trupe_trofeu:1536412945339129857> **Time Vencedor**: ${vencedorTexto}`,
        '',
        `<:trupe_time_a:1536412456010907669> **${labelA} (${partida.get('score_a') || 0})**`,
        idsA || 'Sem jogadores',
        '',
        `<:trupe_time_b:1536412484133715988> **${labelB} (${partida.get('score_b') || 0})**`,
        idsB || 'Sem jogadores',
        '',
        `<:trupe_mvp:1536411420202373120> **MVP**: ${partida.get('mvp') || 'N/A'}`,
        `<:trupe_player_video:1536413056085655572> **Link Demos/Stats**: ${partida.get('link_demo_and_stats') || 'Não informado'}`,
      ].join('\n');

      return await interaction.editReply(componentsV2Payload(
        buildContainer({
          cor: corPorVencedor,
          titulo: `<:trupe_teia:1536412408203976888> Detalhes da Partida #${partida.get('matchid')} — ${rotuloServidor(partida.get('server_id'))}`,
          corpo,
          rodape: temNaoCadastrado
            ? 'Mix Trupe CS2 • ❔ = jogador ainda não fez /registrar'
            : 'Mix Trupe CS2 • Estatísticas de Partidas',
        })
      ));
    } catch (error) {
      console.error('Erro no /partida-info:', error);
      await interaction.editReply(componentsV2Payload(
        buildContainer({ cor: CORES.AVISO, titulo: 'Erro', corpo: '<:trupe_aviso:1536410370829328434> Erro ao consultar os dados da partida.' })
      ));
    }
  },
};
