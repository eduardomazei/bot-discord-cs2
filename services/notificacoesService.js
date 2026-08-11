// Envio de notificações por DM (com ou sem banner personalizado) -- "melhor esforço": nunca
// lança, porque DM fechada/bloqueada é um caso normal (várias pessoas não aceitam DM de bots),
// não um erro a reportar. Devolve true/false pra quem chama poder contar sucesso/falha em
// envios em massa (ex: o convite pra registro, que notifica todo mundo sem cadastro de uma vez).
const { buildContainer, componentsV2Payload } = require('../utils/containers');
const { anexoBanner } = require('../utils/banners');

/**
 * @param {import('discord.js').Client} client
 * @param {string} discordId
 * @param {object} opts
 * @param {string} [opts.bannerKey] - Chave de utils/banners.js (BANNERS.X). Se omitido, manda
 *   só o container sem imagem (ex: aviso de remoção da lista pra abrir vaga, que não tem banner
 *   próprio nos 6 eventos definidos).
 * @param {number} opts.cor
 * @param {string} opts.titulo
 * @param {string} opts.corpo
 * @param {string} [opts.rodape]
 * @returns {Promise<boolean>} true se a DM foi entregue, false se falhou (por qualquer motivo).
 */
async function enviarNotificacaoDM(client, discordId, { bannerKey, cor, titulo, corpo, rodape } = {}) {
  try {
    const user = await client.users.fetch(discordId);

    let imagemUrl;
    let files;
    if (bannerKey) {
      const anexo = anexoBanner(bannerKey);
      imagemUrl = anexo.url;
      files = [anexo.attachment];
    }

    await user.send(componentsV2Payload(
      buildContainer({ cor, titulo, corpo, imagemUrl }),
      files ? { files } : {}
    ));
    return true;
  } catch (err) {
    // DM fechada/bloqueada é esperado e não precisa de log -- mas erro de montagem do container
    // (banner errado, container malformado, etc.) é bug de verdade e precisa aparecer no console,
    // senão fica invisível pra sempre (foi assim que o bug do bannerKey passou despercebido).
    if (err.code !== 50007) { // 50007 = "Cannot send messages to this user" (DM fechada)
      console.error(`Erro ao enviar notificação DM (bannerKey: ${bannerKey || 'nenhum'}):`, err);
    }
    return false;
  }
}

module.exports = { enviarNotificacaoDM };
