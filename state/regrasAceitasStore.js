// Guarda quem já clicou "Eu li e concordo com as regras" -- precisa ser persistido em disco
// (não só cargo Discord, não só planilha) porque uma pessoa pode clicar ANTES de se registrar,
// e o gancho de /registrar (dias depois, ou até depois de um restart do bot) precisa lembrar
// disso pra liberar o acesso na hora certa. Nesse momento pode ainda não existir linha em
// Jogadores pra essa pessoa, então não dá pra guardar lá. Mesmo padrão (JSON em data/, gitignored)
// de state/presencaPersistence.js.
const fs = require('fs');
const path = require('path');

const ARQUIVO = path.join(__dirname, '..', 'data', 'regras-aceitas.json');

let cache = null; // Set<discordId>, carregado sob demanda (lazy) e mantido em memória depois.

function carregar() {
  if (cache) return cache;
  try {
    if (fs.existsSync(ARQUIVO)) {
      const dados = JSON.parse(fs.readFileSync(ARQUIVO, 'utf8'));
      cache = new Set(Array.isArray(dados) ? dados : []);
    } else {
      cache = new Set();
    }
  } catch (err) {
    console.error('[regrasAceitasStore] Erro ao carregar do disco, começando vazio:', err);
    cache = new Set();
  }
  return cache;
}

function salvar() {
  try {
    fs.mkdirSync(path.dirname(ARQUIVO), { recursive: true });
    fs.writeFileSync(ARQUIVO, JSON.stringify([...cache], null, 2), 'utf8');
  } catch (err) {
    // Nunca deixa uma falha de disco derrubar o fluxo do botão -- na pior das hipóteses a
    // pessoa precisa clicar em "Concordo" de novo depois de um restart.
    console.error('[regrasAceitasStore] Erro ao salvar em disco:', err);
  }
}

function marcarAceito(discordId) {
  const set = carregar();
  if (!set.has(discordId)) {
    set.add(discordId);
    salvar();
  }
}

function jaAceitou(discordId) {
  return carregar().has(discordId);
}

module.exports = { marcarAceito, jaAceitou };
