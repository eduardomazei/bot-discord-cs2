// Estado do player de música por guild (conexão de voz, fila, faixa atual, processos filhos em
// uso). Indexado por guildId pelo mesmo motivo que os outros services -- mesmo o bot atendendo
// uma guild só hoje, não há razão pra amarrar o estado a um singleton global.
//
// Extração de áudio via yt-dlp (binário baixado sob demanda por utils/ytDlp.js, não em npm
// install -- ver comentário lá) em vez de play-dl: o YouTube passou a exigir um "PO Token" pra
// liberar a URL de stream mesmo com cookie válido, e o play-dl não acompanha essa exigência com
// a frequência necessária -- busca funcionava, mas play.stream() caía em "Sign in to confirm
// you're not a bot" o tempo todo em IP de datacenter (caso do SquareCloud). yt-dlp é atualizado
// toda semana contra esse tipo de mudança.
//
// yt-dlp entrega o áudio em qualquer container que o YouTube tiver disponível (nem sempre
// Opus puro), então passamos por FFmpeg (ffmpeg-static, binário bundlado) pra normalizar em PCM
// bruto antes do @discordjs/voice -- diferente do play-dl, aqui não dá pra pular a
// transcodificação com segurança.
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  StreamType,
  entersState,
} = require('@discordjs/voice');
const { spawn, execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const ffmpegPath = require('ffmpeg-static');
const { garantirBinarioYtDlp } = require('../utils/ytDlp');
const { buildContainer, componentsV2Payload } = require('../utils/containers');
const { CORES } = require('../utils/colors');

const execFileAsync = promisify(execFile);

const players = new Map(); // guildId -> estado

// O client "web" (padrão do yt-dlp) exige um PO Token pra liberar formatos/URLs de stream, e
// costuma cair em "Sign in to confirm you're not a bot" em IP de datacenter mesmo com cookie
// válido. "tv" e "android" são clients feitos pra dispositivo (controle remoto / app), com fluxo
// de auth mais simples que não depende de PO Token -- na prática, o workaround mais efetivo
// contra esse bloqueio hoje. Lista em ordem de preferência: o yt-dlp tenta o próximo se um falhar.
const ARGS_CLIENT_YT = ['--extractor-args', 'youtube:player_client=tv,android,web'];

// Cookie de sessão do YouTube (ver .env.example / CLAUDE.md) convertido pro formato Netscape
// que o yt-dlp espera em --cookies. Escrito uma vez em disco (data/ já é gitignored -- é dado de
// runtime, não fonte) e reaproveitado entre chamadas.
const CAMINHO_COOKIES = path.join(__dirname, '..', 'data', 'youtube-cookies.txt');
let cookiesEscritos = false;

function garantirArquivoCookies() {
  if (!process.env.YOUTUBE_COOKIE) return null;
  if (cookiesEscritos) return CAMINHO_COOKIES;

  const linhas = process.env.YOUTUBE_COOKIE
    .split(';')
    .map((par) => par.trim())
    .filter(Boolean)
    .map((par) => {
      const idx = par.indexOf('=');
      if (idx === -1) return null;
      const nome = par.slice(0, idx).trim();
      const valor = par.slice(idx + 1).trim();
      // 7 campos separados por tab: domínio, inclui-subdomínios, caminho, seguro, expiração
      // (epoch), nome, valor. Sem expiração real (o export "Header String" do Cookie-Editor não
      // traz isso) -- usamos uma data bem no futuro, o yt-dlp só checa se já expirou.
      return ['.youtube.com', 'TRUE', '/', 'TRUE', '2147483647', nome, valor].join('\t');
    })
    .filter(Boolean);

  const conteudo = `# Netscape HTTP Cookie File\n${linhas.join('\n')}\n`;
  fs.mkdirSync(path.dirname(CAMINHO_COOKIES), { recursive: true });
  fs.writeFileSync(CAMINHO_COOKIES, conteudo, { mode: 0o600 });
  cookiesEscritos = true;
  return CAMINHO_COOKIES;
}

function obterEstado(guildId) {
  return players.get(guildId) || null;
}

function formatarDuracao(segundos) {
  if (!Number.isFinite(segundos)) return '??:??';
  const m = Math.floor(segundos / 60);
  const s = Math.floor(segundos % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

async function buscarFaixa(termo, pedidoPor) {
  const ytDlpPath = await garantirBinarioYtDlp();
  const cookiesPath = garantirArquivoCookies();
  const alvo = /^https?:\/\//i.test(termo) ? termo : `ytsearch1:${termo}`;

  const args = [alvo, '--dump-single-json', '--no-playlist', '--no-warnings', '--skip-download', ...ARGS_CLIENT_YT];
  if (cookiesPath) args.push('--cookies', cookiesPath);

  const { stdout } = await execFileAsync(ytDlpPath, args, { maxBuffer: 20 * 1024 * 1024 });
  const dados = JSON.parse(stdout);
  const video = dados.entries ? dados.entries.find(Boolean) : dados;
  if (!video) return null;

  return {
    titulo: video.title,
    url: video.webpage_url || video.original_url || alvo,
    duracao: formatarDuracao(video.duration),
    autor: video.uploader || video.channel || 'Desconhecido',
    pedidoPor,
  };
}

function encerrarProcessosAtuais(estado) {
  if (!estado.processos) return;
  estado.processos.ytDlp.kill('SIGKILL');
  estado.processos.ffmpeg.kill('SIGKILL');
  estado.processos = null;
}

function criarEstado(guildId, voiceChannel, textChannelId, client) {
  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
  });

  const player = createAudioPlayer();
  connection.subscribe(player);

  const estado = { connection, player, fila: [], tocandoAgora: null, textChannelId, client, processos: null };
  players.set(guildId, estado);

  player.on(AudioPlayerStatus.Idle, () => {
    estado.tocandoAgora = null;
    tocarProxima(guildId);
  });

  player.on('error', (erro) => {
    console.error(`[musicaService] Erro de reprodução na guild ${guildId}:`, erro);
    estado.tocandoAgora = null;
    tocarProxima(guildId);
  });

  // Padrão recomendado pelo @discordjs/voice: Disconnected pode ser uma troca de canal (que
  // reconecta sozinha) ou uma queda de verdade (bot removido do canal) -- só derruba o estado
  // se não voltar a Signalling/Connecting em 5s.
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
    } catch {
      encerrarEstado(guildId);
    }
  });

  return estado;
}

async function tocarProxima(guildId) {
  const estado = players.get(guildId);
  if (!estado) return;

  encerrarProcessosAtuais(estado);

  const proxima = estado.fila.shift();
  if (!proxima) return;

  try {
    // Sem isso, tocar antes do handshake de voz (UDP + chave de criptografia) terminar faz os
    // primeiros pacotes de áudio serem descartados em silêncio -- sem erro nenhum, o player some
    // com o som mas o bot "conecta" e o comando "funciona" normalmente.
    await entersState(estado.connection, VoiceConnectionStatus.Ready, 20_000);

    const ytDlpPath = await garantirBinarioYtDlp();
    const cookiesPath = garantirArquivoCookies();
    const argsYtDlp = [proxima.url, '-f', 'bestaudio/best', '-o', '-', '--no-playlist', '--no-warnings', '--quiet', ...ARGS_CLIENT_YT];
    if (cookiesPath) argsYtDlp.push('--cookies', cookiesPath);

    const processoYtDlp = spawn(ytDlpPath, argsYtDlp, { stdio: ['ignore', 'pipe', 'pipe'] });
    const processoFfmpeg = spawn(
      ffmpegPath,
      ['-i', 'pipe:0', '-analyzeduration', '0', '-loglevel', 'error', '-f', 's16le', '-ar', '48000', '-ac', '2', 'pipe:1'],
      { stdio: ['pipe', 'pipe', 'pipe'] }
    );

    processoYtDlp.stdout.pipe(processoFfmpeg.stdin);
    processoYtDlp.on('error', (erro) => console.error(`[musicaService] Falha ao rodar yt-dlp (guild ${guildId}):`, erro));
    processoFfmpeg.on('error', (erro) => console.error(`[musicaService] Falha ao rodar ffmpeg (guild ${guildId}):`, erro));
    estado.processos = { ytDlp: processoYtDlp, ffmpeg: processoFfmpeg };

    const resource = createAudioResource(processoFfmpeg.stdout, { inputType: StreamType.Raw });
    estado.tocandoAgora = proxima;
    estado.player.play(resource);
  } catch (erro) {
    console.error(`[musicaService] Erro ao iniciar "${proxima.titulo}" na guild ${guildId}:`, erro);
    await avisarFalha(estado, proxima);
    await tocarProxima(guildId);
  }
}

// O erro acima acontece DEPOIS do comando /tocar já ter respondido "Tocando agora" (a busca deu
// certo, só a extração/streaming falhou) -- sem isso, quem usa o bot não teria nenhum aviso
// dentro do Discord de que a faixa não tocou, só um log que só quem tem acesso ao console vê.
async function avisarFalha(estado, faixa) {
  if (!estado.client) return;
  try {
    const canal = await estado.client.channels.fetch(estado.textChannelId);
    if (!canal?.isTextBased()) return;
    const container = buildContainer({
      cor: CORES.ERRO,
      titulo: '🎵 Falha ao tocar',
      corpo: `Não consegui tocar **${faixa.titulo}**. Pulando para a próxima da fila (se houver).`,
    });
    await canal.send(componentsV2Payload(container));
  } catch (erroEnvio) {
    console.error('[musicaService] Falha ao avisar erro de reprodução no canal:', erroEnvio);
  }
}

/**
 * Adiciona uma faixa à fila da guild, criando a conexão de voz se ainda não existir.
 * @returns {{ estado: object, vaiComecarAgora: boolean }}
 */
function adicionarNaFila(guildId, voiceChannel, textChannelId, faixa, client) {
  let estado = players.get(guildId);
  if (!estado) {
    estado = criarEstado(guildId, voiceChannel, textChannelId, client);
  }

  // Precisa ser calculado ANTES do push e de chamar tocarProxima: tocarProxima só marca
  // tocandoAgora depois dos awaits (Ready, yt-dlp), então checar depois do push seria uma
  // corrida (sempre pareceria "false" mesmo quando a faixa vai começar na hora).
  const vaiComecarAgora = !estado.tocandoAgora;

  estado.fila.push(faixa);

  if (vaiComecarAgora) {
    tocarProxima(guildId);
  }

  return { estado, vaiComecarAgora };
}

function pular(guildId) {
  const estado = players.get(guildId);
  if (!estado || !estado.tocandoAgora) return false;
  estado.player.stop(); // dispara o listener Idle, que chama tocarProxima
  return true;
}

function encerrarEstado(guildId) {
  const estado = players.get(guildId);
  if (!estado) return false;
  encerrarProcessosAtuais(estado);
  estado.fila = [];
  estado.player.stop();
  estado.connection.destroy();
  players.delete(guildId);
  return true;
}

module.exports = {
  obterEstado,
  buscarFaixa,
  adicionarNaFila,
  pular,
  encerrarEstado,
  formatarDuracao,
};
