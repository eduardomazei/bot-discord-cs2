// IDs exatos dos cargos Owner e Directors do servidor (únicos autorizados a usar comandos administrativos)
const CARGOS_ADM_IDS = [
  '1534969489827954840', // ID do Owner
  '1512258415395864807'  // ID do Directors (antigo cargo "Administradores"/ADM)
];

// --- FUNÇÃO AUXILIAR: VERIFICA SE O MEMBRO POSSUI CARGO ADMINISTRATIVO (Owner ou Directors) ---
async function ehAdministrador(interaction) {
  try {
    if (!interaction.member) return false;

    const memberRoleIds = Array.isArray(interaction.member.roles)
      ? interaction.member.roles
      : Array.from(interaction.member.roles.cache.keys());

    const temCargoAutorizado = memberRoleIds.some(roleId => CARGOS_ADM_IDS.includes(roleId));
    if (temCargoAutorizado) return true;

    const fetchedMember = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (fetchedMember) {
      return fetchedMember.roles.cache.some(role => CARGOS_ADM_IDS.includes(role.id));
    }

    return false;
  } catch (error) {
    console.error('Erro ao verificar permissão de administrador:', error);
    return false;
  }
}

/**
 * Responde de forma ephemeral informando que o usuário não tem permissão de ADM.
 * @param {import('discord.js').Interaction} interaction
 */
async function replyNoPermission(interaction) {
  const payload = {
    content: '<:trupe_bloqueado:1535757215359828080> Você não tem permissão para usar este comando. É necessário ter o cargo de **Owner** ou **Directors**.',
    ephemeral: true,
  };

  try {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(payload);
    } else {
      await interaction.reply(payload);
    }
  } catch (error) {
    // Nunca deixa isso derrubar o processo (ex: token da interação já expirado).
    console.error('Erro ao responder replyNoPermission:', error);
  }
}

module.exports = { ehAdministrador, replyNoPermission, CARGOS_ADM_IDS };
