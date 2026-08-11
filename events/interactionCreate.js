// Roteador de interações: tenta primeiro a Collection de comandos carregada
// dinamicamente de commands/<categoria>/ (todos os comandos já são modulares). Se a
// interação não for um slash command reconhecido ali — hoje isso é só select menu,
// modal ou botão —, cai em legacy/interactionRouter.js, que trata o select de /regras
// e os modais de /registrar e /importar-partida (ainda sem loader de componentes
// próprio no padrão modular).
const { Events } = require('discord.js');
const { ehAdministrador, replyNoPermission } = require('../utils/permissions');
const { responderErro } = require('../utils/respond');
const legacy = require('../legacy/interactionRouter');

module.exports = {
  name: Events.InteractionCreate,
  async execute(interaction) {
    if (!interaction.isChatInputCommand()) {
      return legacy.execute(interaction);
    }

    const command = interaction.client.commands.get(interaction.commandName);
    if (!command) {
      return legacy.execute(interaction);
    }

    // Guardas declarativas (metadados deste projeto, não do discord.js). Nenhum comando usa
    // apenasAdm hoje (os admin-gated mantêm o próprio ehAdministrador() inline no execute());
    // exigeRegistro: false está só em /registrar, /regras e /server, que precisam funcionar
    // sem cadastro prévio.
    if (command.apenasAdm && !(await ehAdministrador(interaction))) {
      return replyNoPermission(interaction);
    }

    if (command.exigeRegistro !== false) {
      const registrado = await legacy.jogadorEstaRegistrado(interaction.user.id);
      if (!registrado) {
        return legacy.responderTravaDeRegistro(interaction);
      }
    }

    try {
      await command.execute(interaction);
    } catch (error) {
      console.error(`Erro não tratado no comando /${interaction.commandName}:`, error);
      await responderErro(interaction);
    }
  },
};
