const { SlashCommandBuilder } = require('discord.js');
const { buildContainer, componentsV2Payload } = require('../../utils/containers');
const { ehAdministrador } = require('../../utils/permissions');

const COR_HELP = 0x3498db;
const COR_ADM = 0xe74c3c;

function buildContainerPublico(admin) {
  return buildContainer({
    cor: COR_HELP,
    titulo: '<:trupe_discord:1535757221470675034> Comandos — Mix Trupe CS2',
    corpo: [
      'Aqui estão os comandos que qualquer membro pode usar:',
      '',
      '**📅 Presença**',
      '`/presenca confirmar [jogador]` — confirma sua presença (ou a de outro jogador já registrado) no próximo Mix.',
      '`/presenca cancelar [jogador]` — cancela uma presença confirmada.',
      '`/presenca lista` — mostra a lista atual de confirmados, em ordem de prioridade.',
      '',
      '**<:trupe_stats:1535757247446126735> Estatísticas e Ranking**',
      '`/elo [usuario]` — mostra a pontuação de Elo e o histórico de performance de um jogador.',
      '`/player [usuario]` — mostra o perfil do jogador no Mix (pontos, partidas, etc.).',
      '`/ranking` — exibe o Top 10 do Mix Trupe.',
      '`/stats-mapa [mapa] [jogador]` — estatísticas da comunidade ou de um jogador filtradas por mapa.',
      '`/x1 adversario` — compara seu histórico direto (head-to-head) com outro jogador.',
      '`/partida-info [id]` — mostra placar e detalhes de uma partida (a última, se não informar ID).',
      '<a:trupe_trofeu:1535757256560476211> `/hall-da-fama` — recordes históricos da comunidade (maior ADR, kills, winrate).',
      '',
      '**🎲 Partida**',
      '`/sortear [origem]` — sorteia e balanceia os jogadores em times de até 5.',
      '`/pick modo [capitao_a] [capitao_b]` — inicia o veto de mapas (Pick & Ban) de uma partida.',
      '`/registrar` — abre o formulário para vincular suas contas de CS2 (Steam/Faceit).',
      '',
      '**🌐 Servidor**',
      '`/conectar` ou `/server` — mostra os IPs dos servidores de CS2 da Trupe.',
      '`/regras` — abre o painel de regras do Mix Trupe.',
      '',
      '**<a:trupe_live:1535757229939232791> Lives**',
      '`/lives` — se você é um streamer oficial registrado, avisa no canal de lives que está ao vivo.',
    ].join('\n'),
    rodape: admin
      ? undefined
      : 'Mix Trupe CS2 • Precisa de um comando de ADM? Fale com a administração.',
  });
}

function buildContainerAdmin() {
  return buildContainer({
    cor: COR_ADM,
    titulo: '<:trupe_ban:1535757213908467752> Comandos restritos a ADM (Owner/Directors)',
    corpo: [
      '**📅 Presença**',
      '`/presenca criar vagas` — abre uma nova lista de presença.',
      '`/presenca finalizar` — encerra a lista de presença atual manualmente.',
      '',
      '**🎲 Partida**',
      '`/resultado id_partida jogador mapa resultado_jogo kills deaths assists adr` — registra o resultado de uma partida.',
      '`/importar-partida` — puxa o CSV do MatchZy via API e atualiza Elo/Stats.',
      '`/mover-times canal_time_a canal_time_b` — move os dois times para as salas de voz.',
      '`/reunir canal_lobby` — traz todos de volta pro Lobby.',
      '',
      '**⚠️ Disciplina**',
      '`/advertir jogador tipo [motivo]` — aplica advertência com pontuação.',
      '`/ausente jogador` — registra ausência/WO.',
      '`/desadvertir jogador [pontos]` — remove advertências.',
      '',
      '**<:trupe_twitch:1535757260582690847> Streamers e Anúncios**',
      '`/addstreamer jogador canal_twitch` — registra um streamer oficial.',
      '`/removerstreamer jogador` — remove o status de streamer oficial.',
      '`/anuncio titulo descricao canal [cor] [imagem]` — cria um anúncio personalizado.',
      '',
      '**Geral**',
      '`/mudar-nick usuario novo_nick` — altera o apelido de um membro.',
      '`/clear quantidade` — deleta mensagens do canal atual.',
      '`/config` — abre o painel de configuração dos canais do bot.',
    ].join('\n'),
    rodape: 'Mix Trupe CS2 • Ajuda • Você tem acesso administrativo (Owner/Directors)',
  });
}

module.exports = {
  // Não exige cadastro prévio (/registrar) -- reproduz o bypass que hoje vem do
  // despacho antecipado dos comandos modulares em index.js. Ver docs/plans/modularizacao-index-js.md, seção 4.1.
  exigeRegistro: false,

  data: new SlashCommandBuilder()
    .setName('help')
    .setDescription('Mostra os comandos disponíveis para você'),

  async execute(interaction) {
    try {
      const admin = await ehAdministrador(interaction);

      const containers = [buildContainerPublico(admin)];
      if (admin) containers.push(buildContainerAdmin());

      await interaction.reply(componentsV2Payload(containers, { ephemeral: true }));
    } catch (error) {
      console.error('Erro no /help:', error);
      try {
        const payload = {
          content: '<:trupe_erro:1535757225631686686> Ocorreu um erro ao mostrar a ajuda. Tente novamente.',
          ephemeral: true,
        };
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply(payload);
        } else {
          await interaction.reply(payload);
        }
      } catch (fallbackError) {
        console.error('Falha ao enviar mensagem de erro do /help:', fallbackError);
      }
    }
  },
};
