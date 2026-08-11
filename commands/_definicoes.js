// Definições brutas dos 22 slash commands que ainda vivem como um array só,
// movidas de index.js SEM nenhuma alteração de conteúdo (PR2 do plano).
//
// Arquivo temporário: o prefixo `_` é pra o futuro loader de comandos
// (loaders/loadCommands.js, PR3) ignorar este arquivo ao varrer commands/<categoria>/
// — e mesmo sem o prefixo, por não ser uma pasta ele já seria pulado pelo loader.
// Cada item aqui vira o seu próprio commands/<categoria>/<nome>.js (com { data, execute })
// nos PRs 5-8, e este arquivo é deletado no PR9.
//
// Ver docs/plans/modularizacao-index-js.md, PR2.
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = [
  new SlashCommandBuilder()
    .setName('importar-partida')
    .setDescription('[Owner/Directors] Puxa o CSV do MatchZy via API e atualiza os Elos e Stats')
    // Esconde da lista de comandos de quem não tem Administrador (Owner/Directors/Founders/Trupe
    // já têm essa permissão -- ver utils/permissions.js). A checagem de verdade continua sendo
    // ehAdministrador() no handler; isso aqui só evita poluir a lista de quem não pode usar.
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

  new SlashCommandBuilder()
    .setName('presenca')
    .setDescription('Confirmação de presença antecipada para o próximo Mix')
    .addSubcommand(sub =>
      sub.setName('criar')
        .setDescription('[Owner/Directors] Abre uma nova lista de presença com limite de vagas')
        .addIntegerOption(opt =>
          opt.setName('vagas')
            .setDescription('Número total de vagas (ex: 10)')
            .setRequired(true)
        )
        .addIntegerOption(opt =>
          opt.setName('vagas_reserva')
            .setDescription('Vagas na reserva após a lista lotar (padrão: 10; use 0 pra desativar)')
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub.setName('confirmar')
        .setDescription('Confirma sua presença (ou a de outro jogador registrado) no próximo Mix')
        .addUserOption(opt =>
          opt.setName('jogador')
            .setDescription('Confirmar a presença de outro jogador registrado (deixe em branco para confirmar a sua)')
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub.setName('cancelar')
        .setDescription('Cancela sua presença (ou a de outro jogador) no próximo Mix')
        .addUserOption(opt =>
          opt.setName('jogador')
            .setDescription('Cancelar a presença de outro jogador (deixe em branco para cancelar a sua)')
            .setRequired(false)
        )
    )
    .addSubcommand(sub =>
      sub.setName('lista')
        .setDescription('Exibe a lista atual de confirmados, ordenada por prioridade')
    )
    .addSubcommand(sub =>
      sub.setName('finalizar')
        .setDescription('[Owner/Directors] Encerra a lista de presença atual, mesmo sem atingir as vagas')
    )
    .addSubcommand(sub =>
      sub.setName('promover')
        .setDescription('[Owner/Directors] Promove um jogador da reserva pra lista de confirmados, fora da ordem')
        .addUserOption(opt =>
          opt.setName('jogador')
            .setDescription('Jogador da reserva a promover')
            .setRequired(true)
        )
        .addUserOption(opt =>
          opt.setName('remover')
            .setDescription('Jogador confirmado a remover pra abrir vaga (obrigatório se a lista oficial estiver cheia)')
            .setRequired(false)
        )
    ),

  new SlashCommandBuilder()
    .setName('resultado')
    .setDescription('[Owner/Directors] Registra o resultado da partida, atualizando Stats e Elo dos jogadores')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addStringOption(opt =>
      opt.setName('id_partida')
        .setDescription('ID da partida (ex: 101)')
        .setRequired(true)
    )
    .addUserOption(opt =>
      opt.setName('jogador')
        .setDescription('Jogador para registrar os dados')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('mapa')
        .setDescription('Mapa jogado')
        .setRequired(true)
        .addChoices(
          { name: 'Dust2', value: 'De_dust2' },
          { name: 'Mirage', value: 'De_mirage' },
          { name: 'Inferno', value: 'De_inferno' },
          { name: 'Nuke', value: 'De_nuke' },
          { name: 'Ancient', value: 'De_ancient' },
          { name: 'Anubis', value: 'De_anubis' },
          { name: 'Cache', value: 'De_cache' }
        )
    )
    .addStringOption(opt =>
      opt.setName('resultado_jogo')
        .setDescription('Se o jogador Venceu ou Perdeu a partida')
        .setRequired(true)
        .addChoices(
          { name: '🏆 Vitória', value: 'vitoria' },
          { name: '❌ Derrota', value: 'derrota' }
        )
    )
    .addIntegerOption(opt => opt.setName('kills').setDescription('Kills').setRequired(true))
    .addIntegerOption(opt => opt.setName('deaths').setDescription('Deaths').setRequired(true))
    .addIntegerOption(opt => opt.setName('assists').setDescription('Assists').setRequired(true))
    .addNumberOption(opt => opt.setName('adr').setDescription('ADR / Dano Médio por Round').setRequired(true)),

  // /elo migrou para commands/stats/elo.js (migração legacy -> modular, comando 6/21).

  // /player migrou para commands/stats/player.js (migração legacy -> modular, comando 7/21).

  // /hall-da-fama migrou para commands/stats/hall-da-fama.js (migração legacy -> modular, comando 9/21).

  // /x1 migrou para commands/stats/x1.js (migração legacy -> modular, comando 10/21).

  // /mover-times migrou para commands/voz/mover-times.js (migração legacy -> modular, comando 4/21).

  // /reunir migrou para commands/voz/reunir.js (migração legacy -> modular, comando 5/21).

  new SlashCommandBuilder()
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

  new SlashCommandBuilder()
    .setName('registrar')
    .setDescription('Abre o formulário de cadastro para vincular suas contas de CS2')
    .addUserOption(option =>
      option.setName('usuario')
        .setDescription('[Owner/Directors] Cadastrar outro jogador em vez de você mesmo')
        .setRequired(false)
    ),

  // /ranking migrou para commands/stats/ranking.js (migração legacy -> modular, comando 8/21).

  new SlashCommandBuilder()
    .setName('stats-mapa')
    .setDescription('Exibe estatísticas da comunidade ou de um jogador filtradas por mapa')
    .addStringOption(option =>
      option.setName('mapa')
        .setDescription('Selecione o mapa')
        .setRequired(false)
        .addChoices(
          { name: 'Dust2', value: 'De_dust2' },
          { name: 'Mirage', value: 'De_mirage' },
          { name: 'Inferno', value: 'De_inferno' },
          { name: 'Nuke', value: 'De_nuke' },
          { name: 'Ancient', value: 'De_ancient' },
          { name: 'Anubis', value: 'De_anubis' },
          { name: 'Cache', value: 'De_cache' }
        )
    )
    .addUserOption(option =>
      option.setName('jogador')
        .setDescription('Ver estatísticas de um jogador específico no mapa')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
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

  new SlashCommandBuilder()
    .setName('advertir')
    .setDescription('[Owner/Directors] Aplica uma advertência a um jogador, com pontuação de acordo com o tipo')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(option =>
      option.setName('jogador')
        .setDescription('Jogador a ser advertido')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('tipo')
        .setDescription('Tipo de advertência (define quantos pontos serão adicionados)')
        .setRequired(true)
        .addChoices(
          { name: '🕐 Falta ou Atraso (1 ponto)', value: 'falta_atraso' },
          { name: '🚫 Falta de Respeito com ADM/Staff (2 pontos)', value: 'falta_respeito' },
          { name: '💢 Ragequit ou Troll (3 pontos)', value: 'ragequit_troll' }
        )
    )
    .addStringOption(option =>
      option.setName('motivo')
        .setDescription('Detalhes adicionais sobre o ocorrido (opcional)')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('ausente')
    .setDescription('[Owner/Directors] Registra ausência/WO para um jogador que não compareceu ao jogo')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(option =>
      option.setName('jogador')
        .setDescription('Jogador ausente')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('desadvertir')
    .setDescription('[Owner/Directors] Remove advertências e libera punições de um jogador')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addUserOption(option =>
      option.setName('jogador')
        .setDescription('Jogador')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option.setName('pontos')
        .setDescription('Quantos pontos remover (padrão: remove todos e libera qualquer punição)')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('pick')
    .setDescription('Inicia o sistema de Veto de Mapas (Pick & Ban)')
    .addStringOption(option =>
      option.setName('modo')
        .setDescription('Selecione o formato da partida')
        .setRequired(true)
        .addChoices(
          { name: 'MD1 (Melhor de 1)', value: 'MD1' },
          { name: 'MD3 (Melhor de 3)', value: 'MD3' }
        )
    )
    .addUserOption(option =>
      option.setName('capitao_a')
        .setDescription('Capitão do Time A')
        .setRequired(false)
    )
    .addUserOption(option =>
      option.setName('capitao_b')
        .setDescription('Capitão do Time B')
        .setRequired(false)
    ),

  // /server migrou para commands/servidor/server.js (migração legacy -> modular, comando 1/21).

  // /regras migrou para commands/servidor/regras.js (migração legacy -> modular, comando 2/21).

  // /mudar-nick migrou para commands/jogadores/mudar-nick.js (migração legacy -> modular, comando 3/21).
];
