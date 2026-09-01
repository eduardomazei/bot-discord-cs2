// Repetição com backoff pra chamadas transitórias da API do Google Sheets. Existe porque
// gravarPartida() já quebrou no meio por causa disso: um /importar-partida atrás do outro
// (várias partidas de um mesmo mix day, confirmadas em sequência rápida) estourou o limite de
// "requests per minute per user" da Sheets API (HTTP 429) bem no meio da função, deixando
// Stats_Partidas/Jogadores gravados sem o resumo correspondente em Partidas -- sem isso,
// google-spreadsheet só propaga o 429 e derruba a operação inteira.

function ehErroTransitorio(err) {
  const status = err?.response?.status;
  if (status === 429 || status === 500 || status === 503) return true;
  return /quota exceeded|rate limit/i.test(err?.message || '');
}

// tentativas/esperaBaseMs dão até ~4 min de espera total no pior caso (5 tentativas, backoff
// linear 15s/30s/45s/60s) -- cabe dentro da validade de 15 min do token de webhook do Discord
// que o /importar-partida usa pra editar a resposta depois da confirmação por botão.
async function comRetry(fn, { tentativas = 5, esperaBaseMs = 15000, label = '' } = {}) {
  for (let tentativa = 1; tentativa <= tentativas; tentativa++) {
    try {
      return await fn();
    } catch (err) {
      if (!ehErroTransitorio(err) || tentativa === tentativas) throw err;
      const espera = esperaBaseMs * tentativa;
      console.warn(
        `⏳ [retryGoogleApi${label ? ' ' + label : ''}] erro transitório (tentativa ${tentativa}/${tentativas}) -- esperando ${espera / 1000}s: ${err.message}`
      );
      await new Promise(resolve => setTimeout(resolve, espera));
    }
  }
}

module.exports = { comRetry, ehErroTransitorio };
