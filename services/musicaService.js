// Estado do player de música por guild (conexão de voz, fila, faixa atual). Indexado por
// guildId pelo mesmo motivo que os outros services -- mesmo o bot atendendo uma guild só hoje,
// não há razão pra amarrar o estado a um singleton global.
//
// play-dl entrega o áudio do YouTube já em Opus (WebmOpus/OggOpus), então createAudioResource
// não precisa transcodificar via FFmpeg -- só demuxa o container, o que é bem mais leve de CPU/RAM
// no plano SquareCloud do bot. Não adicionar ffmpeg-static/@discordjs/opus sem necessidade real.
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
} = require('@discordjs/voice');
const play = require('play-dl');

// Sem cookie, o YouTube costuma bloquear buscas/streams vindos de IP de datacenter
// ("Sign in to confirm you're not a bot") -- IPs residenciais (dev local) geralmente não
// batem nesse bloqueio, por isso só aparece em produção. Aviso de env ausente já sai de
// config/env.js (YOUTUBE_COOKIE está em OPCIONAIS lá).
if (process.env.YOUTUBE_COOKIE) {
  play.setToken({ youtube: { cookie: process.env.YOUTUBE_COOKIE } });
}

const players = new Map(); // guildId -> estado

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
  let video;

  if (play.yt_validate(termo) === 'video') {
    const info = await play.video_basic_info(termo);
    video = info.video_details;
  } else {
    const resultados = await play.search(termo, { limit: 1, source: { youtube: 'video' } });
    if (!resultados.length) return null;
    video = resultados[0];
  }

  return {
    titulo: video.title,
    url: video.url,
    duracao: formatarDuracao(video.durationInSec),
    autor: video.channel?.name ?? 'Desconhecido',
    pedidoPor,
  };
}

function criarEstado(guildId, voiceChannel, textChannelId) {
  const connection = joinVoiceChannel({
    channelId: voiceChannel.id,
    guildId,
    adapterCreator: voiceChannel.guild.voiceAdapterCreator,
  });

  const player = createAudioPlayer();
  connection.subscribe(player);

  const estado = { connection, player, fila: [], tocandoAgora: null, textChannelId };
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
  // se não voltar a Signalling/Connecting em 5s. Ver docs/research (link nos comentários do
  // repo) -- não é sobre-engenharia, é o exemplo oficial da lib pra esse evento.
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

  const proxima = estado.fila.shift();
  if (!proxima) return;

  try {
    const stream = await play.stream(proxima.url);
    const resource = createAudioResource(stream.stream, { inputType: stream.type });
    estado.tocandoAgora = proxima;
    estado.player.play(resource);
  } catch (erro) {
    console.error(`[musicaService] Erro ao iniciar "${proxima.titulo}" na guild ${guildId}:`, erro);
    await tocarProxima(guildId);
  }
}

/**
 * Adiciona uma faixa à fila da guild, criando a conexão de voz se ainda não existir.
 * @returns {{ estado: object, vaiComecarAgora: boolean }}
 */
function adicionarNaFila(guildId, voiceChannel, textChannelId, faixa) {
  let estado = players.get(guildId);
  if (!estado) {
    estado = criarEstado(guildId, voiceChannel, textChannelId);
  }

  // Precisa ser calculado ANTES do push e de chamar tocarProxima: tocarProxima só marca
  // tocandoAgora depois do await em play.stream(), então checar depois do push seria uma
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
