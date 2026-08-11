require('./config/env');
const { Client, GatewayIntentBits } = require('discord.js');
const { carregarComandos } = require('./loaders/loadCommands');
const { carregarEventos } = require('./loaders/loadEvents');

// --- CLIENTE DISCORD ---
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMembers,
  ],
});

// client.commands: Collection usada pelo roteador de interações
// (events/interactionCreate.js) pra resolver comandos por nome — todos os comandos já são
// modulares (commands/<categoria>/*.js). legacy/interactionRouter.js ainda existe só pro
// select menu de /regras e os modais de /registrar e /importar-partida.
client.commands = carregarComandos();
carregarEventos(client);

// --- REDE DE SEGURANÇA: uma promise rejeitada sem handler em qualquer lugar do
// processo não pode passar batido silenciosamente. Isto é diagnóstico, não
// recuperação — ver docs/research/discord-bot-architecture-best-practices.md §7. ---
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

client.login(process.env.DISCORD_TOKEN);
