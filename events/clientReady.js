const { Events } = require('discord.js');
const { iniciarPollingAdvertencias } = require('../services/advertenciaDmService');

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    console.log(`🤖 Bot online como ${client.user.tag}!`);
    iniciarPollingAdvertencias(client);
  },
};
