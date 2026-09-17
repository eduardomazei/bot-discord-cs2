// Baixa e cacheia o binário do yt-dlp sob demanda, em vez de depender de um pacote npm
// wrapper. Motivo: yt-dlp-exec tem um preinstall que exige Python instalado no ambiente de
// deploy (não garantido no SquareCloud) e yt-dlp-wrap está descontinuado no npm. O yt-dlp em si
// é um binário standalone -- só precisa existir em disco e ser executável, não precisa de
// Python pra RODAR, só alguns pacotes wrapper exigiam isso pra instalar.
const fs = require('fs');
const path = require('path');
const https = require('https');

const NOME_BINARIO = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp';
const CAMINHO_BINARIO = path.join(__dirname, '..', 'bin', NOME_BINARIO);
const URL_DOWNLOAD = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${NOME_BINARIO}`;

let promessaGarantia = null;

function baixarComRedirect(url, destino) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          baixarComRedirect(res.headers.location, destino).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`Download do yt-dlp falhou: HTTP ${res.statusCode}`));
          return;
        }
        const arquivo = fs.createWriteStream(destino, { mode: 0o755 });
        res.pipe(arquivo);
        arquivo.on('finish', () => arquivo.close(() => resolve()));
        arquivo.on('error', reject);
      })
      .on('error', reject);
  });
}

/** @returns {Promise<string>} caminho do binário do yt-dlp, baixando-o na primeira chamada se necessário. */
async function garantirBinarioYtDlp() {
  if (fs.existsSync(CAMINHO_BINARIO)) return CAMINHO_BINARIO;

  if (!promessaGarantia) {
    promessaGarantia = (async () => {
      fs.mkdirSync(path.dirname(CAMINHO_BINARIO), { recursive: true });
      await baixarComRedirect(URL_DOWNLOAD, CAMINHO_BINARIO);
      if (process.platform !== 'win32') {
        fs.chmodSync(CAMINHO_BINARIO, 0o755);
      }
      return CAMINHO_BINARIO;
    })().catch((erro) => {
      promessaGarantia = null; // permite tentar de novo na próxima chamada em vez de travar num erro definitivo
      throw erro;
    });
  }

  return promessaGarantia;
}

module.exports = { garantirBinarioYtDlp };
