// Rede de segurança: um erro não tratado no cliente Discord (ex: reply numa
// interação já expirada) não pode derrubar o processo inteiro do bot, só deve
// ser logado. Movido de index.js sem alteração de lógica.
const { Events } = require('discord.js');

module.exports = {
  name: Events.Error,
  once: false,
  execute(error) {
    console.error('Erro no cliente Discord:', error);
  },
};
