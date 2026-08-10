// Persiste o estado da lista de presença em disco, pra sobreviver a um restart
// do processo — hoje (risco R12 do plano de modularização) um restart zera a
// lista de presença em memória silenciosamente, mesmo com jogadores confirmados.
//
// Isto é uma solução mínima e isolada, adiantada do PR8 (state/presencaStore.js):
// resolve um problema real e urgente (não dá pra reiniciar o bot sem perder uma
// lista ativa) sem depender do resto da extração de estado, que ainda não
// aconteceu. presencaConfig continua sendo um objeto mutável comum dentro de
// legacy/interactionRouter.js — este módulo só salva/carrega ele em disco nos
// pontos em que já é mutado. Quando o PR8 rodar, esta lógica de
// salvar/carregar é reaproveitada dentro do state/presencaStore.js definitivo.
//
// Ver docs/plans/modularizacao-index-js.md §2.2/§11 e risco R12.
const fs = require('fs');
const path = require('path');

// data/ fica fora do controle de versão (ver .gitignore) -- é dado de runtime
// gerado pelo bot, não código-fonte, e é específico de cada ambiente/deploy.
const ARQUIVO = path.join(__dirname, '..', 'data', 'presenca.json');

function salvar(presencaConfig) {
  try {
    fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true });
    fs.writeFileSync(ARQUIVO, JSON.stringify(presencaConfig, null, 2), 'utf8');
  } catch (err) {
    // Nunca deixa uma falha de disco derrubar o fluxo do comando -- na pior das
    // hipóteses a gente só perde a persistência daquela mudança específica.
    console.error('[presencaPersistence] Erro ao salvar estado da lista de presença em disco:', err);
  }
}

function carregar(valorPadrao) {
  try {
    if (!fs.existsSync(ARQUIVO)) return valorPadrao;

    const dados = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8'));

    // Validação mínima de forma: se o arquivo estiver corrompido ou de um
    // formato incompatível, cai pro padrão em vez de propagar um estado quebrado
    // pro resto do bot.
    const formaValida =
      dados && typeof dados === 'object' &&
      typeof dados.aberta === 'boolean' &&
      typeof dados.capacidade === 'number' &&
      Array.isArray(dados.jogadores);

    if (!formaValida) {
      console.warn('[presencaPersistence] data/presenca.json com formato inesperado -- ignorando e usando o padrão.');
      return valorPadrao;
    }

    // Retrocompatibilidade: um data/presenca.json salvo antes da feature de Reserva
    // não tem "reservas"/"vagasReserva" -- completa com o padrão em vez de deixar
    // undefined (que quebraria o primeiro .push/.length em reservas).
    if (!Array.isArray(dados.reservas)) dados.reservas = valorPadrao.reservas ?? [];
    if (typeof dados.vagasReserva !== 'number') dados.vagasReserva = valorPadrao.vagasReserva ?? 10;

    return dados;
  } catch (err) {
    console.error('[presencaPersistence] Erro ao carregar estado da lista de presença do disco:', err);
    return valorPadrao;
  }
}

module.exports = { salvar, carregar };
