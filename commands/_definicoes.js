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

  // /presenca migrou para commands/mix/presenca.js (migração legacy -> modular, comando 21/21 --
  // fecha a migração inteira). Ver docs/plans/modularizacao-index-js.md §2.2 (risco R1).

  // /resultado foi REMOVIDO (não migrado) -- decisão do usuário: /importar-partida (CSV do
  // MatchZy) é a única forma suportada de registrar resultado de partida daqui pra frente.
  // Dados já gravados por /resultado no passado permanecem intactos em Stats_Partidas/Jogadores.

  // /elo migrou para commands/stats/elo.js (migração legacy -> modular, comando 6/21).

  // /player migrou para commands/stats/player.js (migração legacy -> modular, comando 7/21).

  // /hall-da-fama migrou para commands/stats/hall-da-fama.js (migração legacy -> modular, comando 9/21).

  // /x1 migrou para commands/stats/x1.js (migração legacy -> modular, comando 10/21).

  // /mover-times migrou para commands/voz/mover-times.js (migração legacy -> modular, comando 4/21).

  // /reunir migrou para commands/voz/reunir.js (migração legacy -> modular, comando 5/21).

  // /sortear migrou para commands/mix/sortear.js (migração legacy -> modular, comando 19/21).
  // Abre o Grupo 4 -- extrai presencaConfig para state/presencaStore.js (compartilhado com
  // /presenca, que ainda não migrou -- ver risco R1 no comentário do store).

  // /registrar migrou para commands/jogadores/registrar.js (migração legacy -> modular, comando 13/21).
  // Abre o Grupo 3 (escrita em planilha) -- o envio do modal continua em legacy/interactionRouter.js.

  // /ranking migrou para commands/stats/ranking.js (migração legacy -> modular, comando 8/21).

  // /stats-mapa migrou para commands/stats/stats-mapa.js (migração legacy -> modular, comando 11/21).

  // /partida-info migrou para commands/stats/partida-info.js (migração legacy -> modular, comando 12/21).
  // Fecha o Grupo 2 (leitura de planilha).

  // /advertir migrou para commands/moderacao/advertir.js (migração legacy -> modular, comando 15/21).

  // /ausente migrou para commands/moderacao/ausente.js (migração legacy -> modular, comando 16/21).

  // /desadvertir migrou para commands/moderacao/desadvertir.js (migração legacy -> modular, comando 14/21).

  // /pick migrou para commands/mix/pick.js (migração legacy -> modular, comando 20/21).

  // /server migrou para commands/servidor/server.js (migração legacy -> modular, comando 1/21).

  // /regras migrou para commands/servidor/regras.js (migração legacy -> modular, comando 2/21).

  // /mudar-nick migrou para commands/jogadores/mudar-nick.js (migração legacy -> modular, comando 3/21).
];
