// Helper compartilhado pra responder a uma interação que já pode ter sido
// respondida ou adiada (deferred) — usado pelo tratamento de erro central do
// roteador de interações. Mesmo padrão do discordjs.guide (ver
// docs/research/discord-bot-architecture-best-practices.md §7).
const { MessageFlags } = require('discord.js');

async function responderErro(interaction, mensagem = 'Ocorreu um erro ao executar este comando.') {
  const payload = { content: `❌ ${mensagem}`, flags: MessageFlags.Ephemeral };

  try {
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
  } catch (err) {
    // Nunca deixa isso derrubar o processo (ex: token da interação já expirado).
    console.error('Falha ao responder erro para a interação:', err);
  }
}

module.exports = { responderErro };
