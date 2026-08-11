// Banners personalizados usados nas notificações por DM (ver services/notificacoesService.js).
// Cada evento tem seu próprio banner, guardado em assets/banners/. Anexado localmente em cada
// envio via AttachmentBuilder -- ao contrário de referenciar a URL de uma mensagem já postada em
// algum canal, não depende de nenhuma mensagem externa continuar existindo pra sempre.
const path = require('path');
const { AttachmentBuilder } = require('discord.js');

const PASTA_BANNERS = path.join(__dirname, '..', 'assets', 'banners');

// BANNERS: enum -- cada chave aponta pra ela mesma (BANNERS.PROMOVIDO === 'PROMOVIDO'), usado
// nas chamadas de enviarNotificacaoDM (bannerKey: BANNERS.PROMOVIDO). O mapeamento de verdade
// chave -> nome do arquivo fica em ARQUIVOS_POR_BANNER, abaixo, interno a este módulo -- manter
// os dois objetos separados evita o erro de passar BANNERS.X (o nome do arquivo) onde
// anexoBanner() espera a chave.
const BANNERS = {
  REGISTRAR: 'REGISTRAR',           // Convite pra jogador sem cadastro se registrar
  LISTA_CRIADA: 'LISTA_CRIADA',     // /presenca criar
  ADVERTENCIA: 'ADVERTENCIA',       // /advertir
  DESADVERTIR: 'DESADVERTIR',       // /desadvertir
  RESERVA: 'RESERVA',               // Entrou na reserva (/presenca confirmar, lista cheia)
  PROMOVIDO: 'PROMOVIDO',           // Promovido da reserva pra lista oficial
};

const ARQUIVOS_POR_BANNER = {
  [BANNERS.REGISTRAR]: 'banner_registrar.png',
  [BANNERS.LISTA_CRIADA]: 'banner_lista-criada.png',
  [BANNERS.ADVERTENCIA]: 'banner_advertencia.png',
  [BANNERS.DESADVERTIR]: 'banner_desadvertir.png',
  [BANNERS.RESERVA]: 'banner_reserva.png',
  [BANNERS.PROMOVIDO]: 'banner_confirmado.png',
};

// Monta o attachment e a URL "attachment://<arquivo>" que o container (Components V2) usa como
// imagem -- o nome tem que bater exatamente entre os dois, é assim que o Discord casa a imagem
// referenciada no corpo da mensagem com o arquivo anexado junto.
function anexoBanner(chave) {
  const arquivo = ARQUIVOS_POR_BANNER[chave];
  if (!arquivo) {
    throw new Error(`Banner desconhecido: "${chave}". Chaves válidas: ${Object.keys(BANNERS).join(', ')}`);
  }

  const caminho = path.join(PASTA_BANNERS, arquivo);
  return {
    attachment: new AttachmentBuilder(caminho, { name: arquivo }),
    url: `attachment://${arquivo}`,
  };
}

module.exports = { BANNERS, anexoBanner };
