// Único dono de presencaConfig -- extraído de legacy/interactionRouter.js na migração de
// /sortear (comando 19/21).
//
// presencaConfig é MUTADO (.jogadores.push(...), .aberta = false, etc.) em quase todo lugar, o
// que continua funcionando através de qualquer referência ao mesmo objeto -- mutação é visível
// por qualquer código que segure essa referência. O único ponto delicado é REATRIBUIÇÃO da
// variável inteira (só acontece em /presenca criar, ainda em legacy/interactionRouter.js): se
// esse ponto trocasse só a variável local de quem chama, este módulo (e qualquer outro
// consumidor, como /sortear) ficaria preso na referência antiga -- uma "lista fantasma". Por
// isso reatribuição só acontece através de definir(), nunca direto. Ver docs/plans/
// modularizacao-index-js.md §2.2 (risco R1) -- mesmo perigo, resolvido do mesmo jeito descrito lá.
const presencaPersistence = require('./presencaPersistence');

let presencaConfig = presencaPersistence.carregar({
  aberta: false,
  capacidade: 10,
  jogadores: [], // { id, name, timestamp }
  reservas: [], // { id, name, timestamp } -- fila de espera depois que "jogadores" lota
  vagasReserva: 10, // 0 = reserva desativada pra essa lista
  canalId: null,
  mensagemId: null,
  ultimaMensagemPublicaId: null, // mensagem pública de "confirmou/cancelou" mais recente
});

// Devolve a referência viva. Mutações no objeto retornado (.jogadores.push, .aberta = false...)
// são automaticamente visíveis a qualquer outro código que também tenha chamado obter().
function obter() {
  return presencaConfig;
}

// Único jeito seguro de trocar presencaConfig por um objeto novo inteiro (hoje só /presenca
// criar faz isso). Devolve o próprio objeto novo, pra quem chamou reatribuir sua variável local
// também, se precisar (ver comentário do topo).
function definir(novoConfig) {
  presencaConfig = novoConfig;
  return presencaConfig;
}

module.exports = { obter, definir };
