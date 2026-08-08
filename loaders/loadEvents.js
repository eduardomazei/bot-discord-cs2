// Varre events/*.js e registra cada um no client via client.once/client.on,
// conforme o flag `once` do próprio módulo. Ver docs/plans/modularizacao-index-js.md
// §4/§6 (baseado em docs/research/discord-bot-architecture-best-practices.md §4).
const fs = require('fs');
const path = require('path');

function carregarEventos(client) {
  const base = path.join(__dirname, '..', 'events');
  const arquivos = fs.readdirSync(base).filter((arquivo) => arquivo.endsWith('.js'));

  for (const arquivo of arquivos) {
    const evento = require(path.join(base, arquivo));

    if (!evento || !evento.name || typeof evento.execute !== 'function') {
      console.warn(`[loadEvents] ${arquivo} ignorado: falta 'name' ou 'execute'.`);
      continue;
    }

    if (evento.once) {
      client.once(evento.name, (...args) => evento.execute(...args));
    } else {
      client.on(evento.name, (...args) => evento.execute(...args));
    }
  }
}

module.exports = { carregarEventos };
