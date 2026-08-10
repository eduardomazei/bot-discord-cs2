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
const { SlashCommandBuilder } = require('discord.js');

module.exports = [
  new SlashCommandBuilder()
    .setName('importar-partida')
    .setDescription('[Owner/Directors] Puxa o CSV do MatchZy via API e atualiza os Elos e Stats'),

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

  new SlashCommandBuilder()
    .setName('elo')
    .setDescription('Exibe a pontuação de Elo e histórico de performance de um jogador')
    .addUserOption(opt =>
      opt.setName('usuario')
        .setDescription('Jogador para consultar o Elo')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('player')
    .setDescription('Exibe as estatísticas e perfil do jogador no Mix')
    .addUserOption(option =>
      option.setName('usuario')
        .setDescription('Selecione o membro do Discord')
        .setRequired(false)
    ),

  new SlashCommandBuilder()
    .setName('hall-da-fama')
    .setDescription('Exibe os recordes históricos da comunidade (Maior ADR, Kills, Winrate)'),

  new SlashCommandBuilder()
    .setName('x1')
    .setDescription('Compara o histórico head-to-head entre você e outro jogador')
    .addUserOption(opt =>
      opt.setName('adversario')
        .setDescription('Selecione o jogador para comparar estatísticas')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('mover-times')
    .setDescription('[Owner/Directors] Move automaticamente os dois times para as salas de voz especificadas')
    .addChannelOption(opt =>
      opt.setName('canal_time_a')
        .setDescription('Canal de voz do Time A (CT)')
        .setRequired(true)
    )
    .addChannelOption(opt =>
      opt.setName('canal_time_b')
        .setDescription('Canal de voz do Time B (TR)')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('reunir')
    .setDescription('[Owner/Directors] Move todos os jogadores dos canais de time de volta para o Lobby')
    .addChannelOption(opt =>
      opt.setName('canal_lobby')
        .setDescription('Canal de voz do Lobby principal')
        .setRequired(true)
    ),

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

  new SlashCommandBuilder()
    .setName('ranking')
    .setDescription('Exibe o Leaderboard com o Top 10 jogadores do Mix Trupe'),

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
    .addUserOption(option =>
      option.setName('jogador')
        .setDescription('Jogador ausente')
        .setRequired(true)
    ),

  new SlashCommandBuilder()
    .setName('desadvertir')
    .setDescription('[Owner/Directors] Remove advertências e libera punições de um jogador')
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

  new SlashCommandBuilder()
    .setName('conectar')
    .setDescription('Exibe os IPs dos servidores de CS2 da Trupe'),

  new SlashCommandBuilder()
    .setName('server')
    .setDescription('Exibe os IPs dos servidores de CS2 da Trupe'),

  new SlashCommandBuilder()
    .setName('regras')
    .setDescription('Exibe o painel interativo de regras do Mix Trupe'),

  new SlashCommandBuilder()
    .setName('mudar-nick')
    .setDescription('[Owner/Directors] Altera o apelido de um membro do servidor')
    .addUserOption(option =>
      option.setName('usuario')
        .setDescription('Membro que terá o nick alterado')
        .setRequired(true)
    )
    .addStringOption(option =>
      option.setName('novo_nick')
        .setDescription('Novo apelido para o membro')
        .setRequired(true)
    ),
];
