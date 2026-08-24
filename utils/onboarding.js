// Gate de entrada: quem entra no servidor recebe o cargo "Não-verificado"
// (events/guildMemberAdd.js), que fica com "Ver Canal" negado em toda categoria exceto
// Boas-vindas (configurado manualmente/via script nas categorias -- ver docs/plans). Só recupera
// acesso ao resto do servidor depois de cumprir os dois requisitos, em qualquer ordem:
//   1. Completar /registrar (linha própria na aba Jogadores)
//   2. Clicar "Concordo" no painel de regras (customId regras_concordo)
// Ao cumprir os dois, o cargo "Não-verificado" é removido e o cargo "Hubmix" (cargo de membro
// pleno já existente no servidor) é adicionado.
//
// "Concordo" é rastreado via state/regrasAceitasStore.js (arquivo em disco), não como cargo
// Discord nem coluna na planilha -- porque alguém pode clicar no botão ANTES de se registrar, e
// nesse momento ainda não existe linha em Jogadores pra guardar esse flag.
const { jogadorEstaRegistrado } = require('../services/registroService');
const regrasAceitasStore = require('../state/regrasAceitasStore');

const ROLE_NAO_VERIFICADO_ID = process.env.ROLE_NAO_VERIFICADO_ID;
const ROLE_HUBMIX_ID = process.env.ROLE_HUBMIX_ID;

/**
 * Chamada depois de CADA um dos dois passos (não sabe qual aconteceu primeiro). Se os dois já
 * estiverem cumpridos, troca "Não-verificado" por "Hubmix".
 * @param {import('discord.js').GuildMember} member
 * @returns {Promise<boolean>} true se o membro está liberado (agora ou já antes); false se ainda falta algo.
 */
async function verificarEDesbloquear(member) {
  if (!member) return false;

  try {
    const jaRegistrado = await jogadorEstaRegistrado(member.id);
    const jaAceitouRegras = regrasAceitasStore.jaAceitou(member.id);

    if (!jaRegistrado || !jaAceitouRegras) return false;

    if (ROLE_NAO_VERIFICADO_ID && member.roles.cache.has(ROLE_NAO_VERIFICADO_ID)) {
      await member.roles.remove(ROLE_NAO_VERIFICADO_ID);
    }
    if (ROLE_HUBMIX_ID && !member.roles.cache.has(ROLE_HUBMIX_ID)) {
      await member.roles.add(ROLE_HUBMIX_ID);
    }
    return true;
  } catch (err) {
    console.error('[onboarding] Erro ao verificar/desbloquear acesso:', err);
    return false;
  }
}

module.exports = { verificarEDesbloquear, ROLE_NAO_VERIFICADO_ID, ROLE_HUBMIX_ID };
