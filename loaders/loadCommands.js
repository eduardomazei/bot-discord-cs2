// Varre commands/<categoria>/*.js e monta a Collection de comandos carregados
// dinamicamente. Compartilhado por index.js e por deploy-commands.js (nos PRs
// futuros — por enquanto deploy-commands.js ainda lê commands/_definicoes.js
// direto, ver §7 do plano) pra garantir que os dois nunca divirjam.
//
// commands/_definicoes.js (os 22 comandos ainda não modularizados) fica de fora
// naturalmente: não é uma pasta, então cai no `continue` abaixo.
//
// Ver docs/plans/modularizacao-index-js.md §1/§6 (baseado em
// docs/research/discord-bot-architecture-best-practices.md §1).
const fs = require('fs');
const path = require('path');
const { Collection } = require('discord.js');

function carregarComandos() {
  const collection = new Collection();
  const base = path.join(__dirname, '..', 'commands');

  for (const entrada of fs.readdirSync(base)) {
    const dir = path.join(base, entrada);
    if (!fs.statSync(dir).isDirectory()) continue;

    const arquivos = fs.readdirSync(dir).filter((arquivo) => arquivo.endsWith('.js'));
    for (const arquivo of arquivos) {
      const comando = require(path.join(dir, arquivo));

      if ('data' in comando && 'execute' in comando) {
        collection.set(comando.data.name, comando);
      } else {
        console.warn(`[loadCommands] ${entrada}/${arquivo} ignorado: falta 'data' ou 'execute'.`);
      }
    }
  }

  return collection;
}

module.exports = { carregarComandos };
