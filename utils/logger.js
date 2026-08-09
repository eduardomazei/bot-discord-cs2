// Logger mínimo, sem dependência nova. Substitui os `console.error('Erro ao ...')`
// espalhados pelo projeto, que hoje não têm timestamp nem identificação de onde
// vieram — em produção isso é a diferença entre "achei o erro" e "não faço ideia
// de quando isso aconteceu". Ver docs/plans/modularizacao-index-js.md §8.3.
//
// Uso: const log = require('./utils/logger'); log.error('presenca', 'Erro ao...', err);
// O primeiro argumento é o "escopo" (comando/módulo de origem) e é opcional.

function timestamp() {
  return new Date().toISOString();
}

function linha(nivel, escopo, args) {
  const prefixo = escopo ? `[${timestamp()}] [${nivel}] [${escopo}]` : `[${timestamp()}] [${nivel}]`;
  return [prefixo, ...args];
}

module.exports = {
  info(escopo, ...args) {
    console.log(...linha('INFO', escopo, args));
  },
  warn(escopo, ...args) {
    console.warn(...linha('WARN', escopo, args));
  },
  error(escopo, ...args) {
    console.error(...linha('ERROR', escopo, args));
  },
};
