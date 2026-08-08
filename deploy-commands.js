// Script standalone de registro dos slash commands — roda manualmente (`npm run deploy`),
// nunca como parte do boot do bot. Usa só o REST manager (não o Client completo): não é
// necessário nem desejável conectar ao gateway pra isso.
//
// Ver docs/plans/modularizacao-index-js.md §2 e §7 (baseado em
// docs/research/discord-bot-architecture-best-practices.md §2).
require('./config/env');
const { REST, Routes } = require('discord.js');

const definicoesLegado = require('./commands/_definicoes');

// Os 7 comandos já modulares (commands/help.js etc.) — mesmo mapa usado hoje em index.js.
// Isto vira uma chamada única a um loader compartilhado (loaders/loadCommands.js) no PR3;
// por enquanto duplica a lista pra não depender de código que ainda não existe.
const commandModules = {
  help: require('./commands/help'),
  lives: require('./commands/lives'),
  anuncio: require('./commands/anuncio'),
  addstreamer: require('./commands/addstreamer'),
  removerstreamer: require('./commands/removerstreamer'),
  config: require('./commands/config'),
  clear: require('./commands/clear'),
};

const body = [
  ...definicoesLegado.map((builder) => builder.toJSON()),
  ...Object.values(commandModules).map((modulo) => modulo.data.toJSON()),
];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), { body })
  .then((data) => {
    console.log(`✅ ${data.length} comandos registrados na guild ${process.env.GUILD_ID}.`);
  })
  .catch((error) => {
    console.error('❌ Erro ao registrar comandos:', error);
    process.exitCode = 1;
  });
