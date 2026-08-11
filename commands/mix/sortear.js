const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { CORES } = require('../../utils/colors');
const presencaStore = require('../../state/presencaStore');

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
    // Leitura -- /sortear nunca escreve em presencaConfig, só lê .jogadores. O dono real do
    // estado é state/presencaStore.js (compartilhado com /presenca, ainda no legado).
    const presencaConfig = presencaStore.obter();

    if (origem === 'voz' && !interaction.member.voice.channel) {
      return interaction.reply({
        content: '<:trupe_erro:1536410911617843322> Você precisa estar em um canal de voz para usar este comando! (ou use `origem: Lista de Presença`)',
        ephemeral: true,
      });
    }

    if (origem === 'presenca' && presencaConfig.jogadores.length < 2) {
      return interaction.reply({
        content: '<:trupe_erro:1536410911617843322> A lista de presença precisa ter pelo menos 2 jogadores confirmados para sortear.',
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    let membrosParaSortear = [];

    if (origem === 'presenca') {
      const listaOrdenada = [...presencaConfig.jogadores].sort((a, b) => a.timestamp - b.timestamp);
      for (const p of listaOrdenada) {
        const membro = await interaction.guild.members.fetch(p.id).catch(() => null);
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

      const rankMap = [
        { key: 'SS', weight: 7 },
        { key: 'S',  weight: 6 },
        { key: 'A',  weight: 5 },
        { key: 'B',  weight: 4 },
        { key: 'C',  weight: 3 },
        { key: 'D',  weight: 2 },
        { key: 'E',  weight: 0 },
      ];

      for (const rank of rankMap) {
        if (tag === rank.key) {
          return { rank: rank.key, weight: rank.weight };
        }
      }
      return { rank: 'Sem Rank', weight: 3 };
    }

    const players = membrosParaSortear.map(m => {
      const rankInfo = parseRank(m.displayName);
      return {
        name: m.displayName,
        weight: rankInfo.weight,
        rank: rankInfo.rank
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

    const formatTeam = (team) => team.map(p => `• **${p.name}** \`[Rank ${p.rank} - ${p.weight} pts]\``).join('\n');

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
