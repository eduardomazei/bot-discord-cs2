const { Events } = require('discord.js');
const { iniciarPollingAdvertencias } = require('../services/advertenciaDmService');
const { iniciarReconciliacaoRegistroSite } = require('../services/reconciliarRegistroSite');
const { iniciarReconciliacaoNivelamento } = require('../services/reconciliarNivelamento');

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    console.log(`🤖 Bot online como ${client.user.tag}!`);
    iniciarPollingAdvertencias(client);
    iniciarReconciliacaoRegistroSite(client);
    iniciarReconciliacaoNivelamento(client);
  },
};
