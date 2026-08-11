// Script standalone de registro dos slash commands — roda manualmente (`npm run deploy`),
// nunca como parte do boot do bot. Usa só o REST manager (não o Client completo): não é
// necessário nem desejável conectar ao gateway pra isso.
//
// Ver docs/plans/modularizacao-index-js.md §2 e §7 (baseado em
// docs/research/discord-bot-architecture-best-practices.md §2).
require('./config/env');
const { REST, Routes } = require('discord.js');
const { carregarComandos } = require('./loaders/loadCommands');

const definicoesLegado = require('./commands/_definicoes');

// Comandos já modulares (commands/<categoria>/*.js) — via o mesmo loader compartilhado que
// index.js usa, em vez de uma lista manual duplicada com caminhos fixos (que ficou desatualizada
// e quebrou depois que os comandos foram organizados em subpastas por categoria).
const comandosModulares = carregarComandos();

const body = [
  ...definicoesLegado.map((builder) => builder.toJSON()),
  ...comandosModulares.map((modulo) => modulo.data.toJSON()),
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
