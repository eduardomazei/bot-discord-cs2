const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { CORES } = require('../../utils/colors');
const { getTitularesListaAberta } = require('../../utils/presencaSupabase');
const { getSheet } = require('../../utils/sheets');
const { RANKS, obterRank } = require('../../utils/ranks');

// Mesma escala de peso que já existia pro parser de nick (ver parseRank) -- reaproveitada pro
// rank real vindo do Elo, pra não mudar o equilíbrio de quem já dependia dela.
const PESOS_RANK = { E: 0, D: 2, C: 3, B: 4, A: 5, S: 6, SS: 7 };
const RANK_POR_NOME = Object.fromEntries(RANKS.map(r => [r.nome, r]));

module.exports = {
  // exigeRegistro fica no default (true) -- 'sortear' não estava em
  // comandosLiberados no legado, então já exigia cadastro antes desta migração.

  data: new SlashCommandBuilder()
    .setName('sortear')
    .setDescription('Sorteia e balanceia os jogadores em times de até 5 (CS2)')
    .addStringOption(opt =>
      opt.setName('origem')
        .setDescription('De onde tirar os jogadores para o sorteio (padrão: canal de voz)')
        .setRequired(false)
        .addChoices(
          { name: '🔊 Canal de Voz (padrão)', value: 'voz' },
          { name: '📅 Lista de Presença', value: 'presenca' }
        )
    ),

  async execute(interaction) {
    const origem = interaction.options.getString('origem') || 'voz';

    if (origem === 'voz' && !interaction.member.voice.channel) {
      return interaction.reply({
        content: '<:trupe_erro:1536410911617843322> Você precisa estar em um canal de voz para usar este comando! (ou use `origem: Lista de Presença`)',
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    let membrosParaSortear = [];

    if (origem === 'presenca') {
      // A lista de presença agora mora no site (trupe-site) — os titulares vêm de lá,
      // na ordem de quem confirmou primeiro. O /presenca do bot é outra coisa (legado).
      let titulares;
      try {
        ({ titulares } = await getTitularesListaAberta());
      } catch (err) {
        console.error('Erro ao ler lista de presença do site:', err.message);
        return interaction.editReply({
          content: '<:trupe_erro:1536410911617843322> Não deu pra ler a lista de presença do site agora. Tenta de novo ou use `origem: Canal de Voz`.',
        });
      }
      if (titulares.length < 2) {
        return interaction.editReply({
          content: '<:trupe_erro:1536410911617843322> A lista de presença do site precisa ter pelo menos 2 titulares confirmados. Abra/confirme em trupemix.com.br/presenca.',
        });
      }
      for (const discordId of titulares) {
        const membro = await interaction.guild.members.fetch(discordId).catch(() => null);
        if (membro && !membro.user.bot) membrosParaSortear.push(membro);
      }
    } else {
      membrosParaSortear = Array.from(interaction.member.voice.channel.members.values()).filter(m => !m.user.bot);
    }

    if (membrosParaSortear.length < 2) {
      return interaction.editReply({
        content: '<:trupe_erro:1536410911617843322> É necessário ter pelo menos 2 pessoas para sortear.'
      });
    }

    // Fallback pra quem NÃO está registrado (sem Elo calculado) -- lê a tag de rank que a
    // pessoa mesma colocou no nick. Quem está registrado usa o Elo de verdade (ver players.map
    // abaixo); esse parser só existia sozinho antes e valia pra todo mundo, o que deixava o
    // balanceamento refém de um texto digitado à mão em vez do desempenho real. Ver
    // docs/plans/sistema-ranks.md.
    function parseRank(displayName) {
      // A tag de rank vem sempre antes do separador vertical no nick (ex: "♛ 𝕊𝕊 ┃ Nick",
      // "✶𝖡 ┃ Nick"). Dois detalhes desses nicks quebravam o parser antigo:
      // 1) o separador não é o "|" normal, é o caractere decorativo "┃" (e variantes parecidas);
      // 2) as letras do rank usam fontes unicode estilizadas (𝖲𝖲, 𝕊, 𝖠, 𝖡...), não A-Z comuns.
      // normalize('NFKD') resolve o ponto 2 (converte qualquer estilo — negrito, itálico,
      // sans-serif, double-struck, etc. — de volta pra letra ASCII simples); o resto continua
      // removendo tudo que não é letra e comparando só o que restar.
      const normalizado = displayName.normalize('NFKD');
      const antesDoPipe = normalizado.split(/[|┃│∣❘｜]/)[0] || '';
      const tag = antesDoPipe.replace(/[^a-zA-Z]/g, '').toUpperCase();

      // Mesma lista de letras válidas do rank real (utils/ranks.js) -- checagem é sempre por
      // igualdade exata, então a ordem de iteração não afeta o resultado (SS não é confundido com S).
      if (RANK_POR_NOME[tag]) {
        return { rank: tag, weight: PESOS_RANK[tag] };
      }
      return { rank: 'Sem Rank', weight: 3 };
    }

    // Elo real (Jogadores) tem prioridade sobre a tag do nick -- só cai pro parser de nick quem
    // não está registrado (sem Elo calculado ainda).
    const sheetJogadores = await getSheet('Jogadores');
    const rowsJogadores = await sheetJogadores.getRows();
    const eloPorDiscordId = new Map();
    rowsJogadores.forEach(r => {
      const id = r.get('discord_id');
      if (id) eloPorDiscordId.set(id, parseInt(r.get('elo') || 1000));
    });

    const players = membrosParaSortear.map(m => {
      const eloRegistrado = eloPorDiscordId.get(m.id);
      const rankInfo = eloRegistrado !== undefined
        ? { rank: obterRank(eloRegistrado).nome, weight: PESOS_RANK[obterRank(eloRegistrado).nome] }
        : parseRank(m.displayName);

      return {
        id: m.id,
        name: m.displayName,
        weight: rankInfo.weight,
        rank: rankInfo.rank,
        emoji: RANK_POR_NOME[rankInfo.rank]?.emoji || '',
      };
    });

    players.sort((a, b) => b.weight - a.weight || (Math.random() - 0.5));

    // Times de até 5 jogadores (padrão CS2 5x5). Com mais de 10 jogadores, forma
    // vários times de 5 em vez de só dois.
    const TAMANHO_TIME = 5;
    const numTimes = Math.max(2, Math.ceil(players.length / TAMANHO_TIME));

    if (numTimes > 25) {
      return await interaction.editReply({
        content: `<:trupe_erro:1536410911617843322> Muitos jogadores para exibir (${players.length}). Reduza a lista antes de sortear.`
      });
    }

    const tamanhoBase = Math.floor(players.length / numTimes);
    const timesComExtra = players.length % numTimes;

    const times = Array.from({ length: numTimes }, (_, i) => ({
      membros: [],
      pontos: 0,
      capacidade: tamanhoBase + (i < timesComExtra ? 1 : 0),
    }));

    players.forEach(p => {
      const disponiveis = times.filter(t => t.membros.length < t.capacidade);
      disponiveis.sort((a, b) => a.pontos - b.pontos);
      const escolhido = disponiveis[0];
      escolhido.membros.push(p);
      escolhido.pontos += p.weight;
    });

    // Menção clicável em vez do nick como texto -- field.value de embed renderiza <@id> (título
    // não renderiza, mas aqui é campo). Emoji fora do code span porque `` desativa a renderização
    // de emoji customizado, só mostraria o texto cru.
    const formatTeam = (team) => team.map(p => `• <@${p.id}> — ${p.emoji ? p.emoji + ' ' : ''}**${p.rank}** *(${p.weight} pts)*`).join('\n');

    const nomesTimes = numTimes === 2
      ? ['🔵 TIME A (CT)', '🟡 TIME B (TR)']
      : times.map((_, i) => `🎯 TIME ${i + 1}`);

    const fields = times.map((t, i) => ({
      name: `${nomesTimes[i]} — Total: ${t.pontos} pts`,
      value: formatTeam(t.membros) || 'Nenhum jogador',
      inline: false
    }));

    const diferencaMaxima = Math.max(...times.map(t => t.pontos)) - Math.min(...times.map(t => t.pontos));

    const embedSorteio = new EmbedBuilder()
      .setTitle(numTimes === 2 ? '<:trupe_teia:1536412408203976888> Sorteio Balanceado de Times (CS2)' : `<:trupe_teia:1536412408203976888> Sorteio Balanceado — ${numTimes} Times de CS2`)
      .setColor(CORES.INFO)
      .addFields(fields)
      .setFooter({ text: `Origem: ${origem === 'presenca' ? 'Lista de Presença' : 'Canal de Voz'} • ${players.length} jogadores em ${numTimes} time(s) • Diferença máxima de equilíbrio: ${diferencaMaxima} pts` })
      .setTimestamp();

    await interaction.editReply({ embeds: [embedSorteio] });
  },
};
