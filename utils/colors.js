// Paleta de cor única do bot, por significado semântico -- antes desse módulo existiam ~14
// tons hex diferentes espalhados entre legacy/interactionRouter.js e as constantes COR_* de
// cada commands/<categoria>/*.js, com variações redundantes pro mesmo significado (dois
// vermelhos de erro, três laranjas, dois azuis). Cada constante aqui usa o tom que já era mais
// comum no código, em vez de inventar uma cor nova sem necessidade.
//
// Cores fora dessa paleta continuam existindo de propósito em alguns lugares específicos (ex:
// o roxo da Twitch em streamer/lives, ou a cor dinâmica por time vencedor em /partida-info) --
// não são "esquecimento", são identidade de feature. Só a duplicação de status genérico
// (sucesso/erro/aviso/info/neutro/encerrado) foi consolidada aqui.
const CORES = {
  SUCESSO: 0x2ECC71,   // verde -- confirmação, vitória, ação concluída
  ERRO: 0xE74C3C,      // vermelho -- recusa, falha, punição severa
  AVISO: 0xF1C40F,     // amarelo -- pendente, atenção, estado intermediário
  INFO: 0x3498DB,      // azul -- informativo, neutro-positivo
  NEUTRO: 0xE67E22,    // laranja -- neutro/pendente sem ser erro nem sucesso
  ENCERRADO: 0x95A5A6, // cinza -- lista/estado fechado, inativo
};

module.exports = { CORES };
