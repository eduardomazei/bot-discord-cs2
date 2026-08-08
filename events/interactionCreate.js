// Roteador NOVO de interações — padrão strangler fig (ver
// docs/plans/modularizacao-index-js.md §6/§9, PR3): tenta primeiro a Collection
// de comandos carregada dinamicamente de commands/<categoria>/; se a interação
// não for um slash command reconhecido ali (hoje: qualquer select menu, modal,
// botão, ou um dos 22 comandos que ainda só existem em commands/_definicoes.js),
// cai no roteador antigo em legacy/interactionRouter.js.
//
// Content dos 22 comandos ainda não migrados fica só no legacy — não há
// duplicação de lógica.
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

    // Guardas declarativas (metadados deste projeto, não do discord.js — ver
    // docs/plans/modularizacao-index-js.md §4.1). Nenhum comando migrado até o
    // PR3 usa apenasAdm; exigeRegistro:false está presente nos 7 comandos
    // modulares pra reproduzir o bypass que hoje vem do despacho antecipado
    // deles em index.js.
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
