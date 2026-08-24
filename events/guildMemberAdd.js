// Atribui o cargo "Não-verificado" a todo humano que entra no servidor -- só a partir de agora,
// ninguém que já estava no servidor antes desse gate existir foi tocado. Esse cargo fica com
// "Ver Canal" negado em toda categoria exceto Boas-vindas; ver utils/onboarding.js pra como ele
// é removido depois que a pessoa cumpre /registrar + botão "Concordo" em #regras.
const { Events } = require('discord.js');
const { ROLE_NAO_VERIFICADO_ID } = require('../utils/onboarding');

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    if (member.user.bot) return;
    if (!ROLE_NAO_VERIFICADO_ID) return; // .env sem a var -- gate desligado, não trava ninguém.

    try {
      await member.roles.add(ROLE_NAO_VERIFICADO_ID);
    } catch (err) {
      console.error('[guildMemberAdd] Erro ao atribuir cargo Não-verificado:', err);
    }
  },
};
