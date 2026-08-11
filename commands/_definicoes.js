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
  // /importar-partida migrou para commands/partidas/importar-partida.js (migração legacy ->
  // modular, comando 18/21 -- fecha o Grupo 3). O envio do modal continua em
  // legacy/interactionRouter.js.

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

  // /resultado foi REMOVIDO (não migrado) -- decisão do usuário: /importar-partida (CSV do
  // MatchZy) é a única forma suportada de registrar resultado de partida daqui pra frente.
  // Dados já gravados por /resultado no passado permanecem intactos em Stats_Partidas/Jogadores.

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

  // /registrar migrou para commands/jogadores/registrar.js (migração legacy -> modular, comando 13/21).
  // Abre o Grupo 3 (escrita em planilha) -- o envio do modal continua em legacy/interactionRouter.js.

  // /ranking migrou para commands/stats/ranking.js (migração legacy -> modular, comando 8/21).

  // /stats-mapa migrou para commands/stats/stats-mapa.js (migração legacy -> modular, comando 11/21).

  // /partida-info migrou para commands/stats/partida-info.js (migração legacy -> modular, comando 12/21).
  // Fecha o Grupo 2 (leitura de planilha).

  // /advertir migrou para commands/moderacao/advertir.js (migração legacy -> modular, comando 15/21).

  // /ausente migrou para commands/moderacao/ausente.js (migração legacy -> modular, comando 16/21).

  // /desadvertir migrou para commands/moderacao/desadvertir.js (migração legacy -> modular, comando 14/21).

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
