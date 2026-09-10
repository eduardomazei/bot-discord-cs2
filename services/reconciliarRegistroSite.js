// Reconciliação do registro feito PELO SITE (trupe-site, app/registro).
//
// O site cria a linha em `jogadores` no Supabase (+ dual-write na aba "Jogadores" do Sheet) e
// marca `regras_aceitas_em`, mas não consegue mexer no Discord. Este job fecha o que falta pra
// quem se registrou pelo site:
//   1. Onboarding gate — marca as regras como aceitas no store do bot (state/regrasAceitasStore)
//      e roda verificarEDesbloquear() pra trocar o cargo "Não-verificado" por "Hubmix".
//   2. Apelido — padroniza pro formato neutro "✶ ┃ Nome" enquanto a pessoa não tiver rank_trupe
//      (mesma regra do modal do /registrar). Um /rankear depois aplica a tag de rank real.
//
// O fluxo 100% Discord (/registrar + botão "Concordo") não passa por aqui e continua igual.
//
// Regra de ouro (igual aos outros services): nada aqui pode derrubar o processo. Só log.
const { getSupabase } = require('../utils/supabase');
const { nomeLimpo, TAG_NEUTRA, montarNick } = require('../utils/ranks');
const { verificarEDesbloquear, ROLE_NAO_VERIFICADO_ID } = require('../utils/onboarding');
const { invalidarRegistroCache } = require('./registroService');
const regrasAceitasStore = require('../state/regrasAceitasStore');

const INTERVALO_MS = 3 * 60 * 1000;
const PAUSA_ENTRE_MS = 800;
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

async function processar(client) {
  let sb;
  try {
    sb = getSupabase();
  } catch {
    return; // Supabase não configurado neste ambiente — silencioso, mesma regra dos syncs.
  }

  const guild = client.guilds.cache.get(process.env.GUILD_ID)
    || (process.env.GUILD_ID ? await client.guilds.fetch(process.env.GUILD_ID).catch(() => null) : null);
  if (!guild) return;

  // Candidatos: quem tem Steam vinculada + regras aceitas. É um conjunto pequeno e que só
  // encolhe (uma vez liberado + apelido ok, não sobra nada pra fazer nos ticks seguintes).
  const { data: linhas, error } = await sb
    .from('jogadores')
    .select('discord_id, nome, discord_nick, rank_trupe, elo, steamid64, regras_aceitas_em')
    .not('regras_aceitas_em', 'is', null)
    .not('steamid64', 'is', null)
    .limit(50);
  if (error) {
    console.error('[reconciliar-site] erro ao buscar candidatos:', error.message);
    return;
  }
  if (!linhas || linhas.length === 0) return;

  // O gate lê o cadastro de um cache com TTL de 30s — invalida pra enxergar o que o site
  // acabou de escrever no Sheet.
  invalidarRegistroCache();

  for (const row of linhas) {
    const member = await guild.members.fetch(row.discord_id).catch(() => null);
    if (!member) continue; // ainda não está no servidor — pega no próximo tick, depois que entrar

    const temNaoVerificado = !!ROLE_NAO_VERIFICADO_ID && member.roles.cache.has(ROLE_NAO_VERIFICADO_ID);
    const semRank = !(row.rank_trupe || '').trim();
    const nome = nomeLimpo(row.nome) || nomeLimpo(member.displayName) || member.displayName;
    const nickNeutro = montarNick(nome, TAG_NEUTRA);
    const precisaNick = semRank && member.manageable && member.displayName !== nickNeutro;

    if (!temNaoVerificado && !precisaNick) continue; // nada a fazer

    try {
      // 1. Onboarding gate. O site já validou o aceite das regras; ensina isso ao store do
      //    bot (idempotente) e deixa o verificarEDesbloquear fazer a troca de cargo.
      regrasAceitasStore.marcarAceito(row.discord_id);
      const liberado = await verificarEDesbloquear(member);

      // 2. Apelido neutro (só enquanto não rankeado).
      let renomeado = false;
      if (precisaNick) {
        await member.setNickname(nickNeutro, 'Padroniza apelido no cadastro pelo site (tag neutra até rankear)');
        renomeado = true;
        // Espelha no Supabase o nome limpo + apelido (best-effort).
        await sb.from('jogadores')
          .update({ nome, discord_nick: nickNeutro })
          .eq('discord_id', row.discord_id)
          .then(({ error: e }) => { if (e) console.error('[reconciliar-site] erro ao espelhar nick:', e.message); });
      }

      if (liberado || renomeado) {
        console.log(`[reconciliar-site] ${row.discord_id}: ${liberado ? 'acesso liberado' : ''}${liberado && renomeado ? ' + ' : ''}${renomeado ? `apelido → ${nickNeutro}` : ''}`.trim());
      }
    } catch (err) {
      console.error(`[reconciliar-site] falha ao processar ${row.discord_id}:`, err.message);
    }
    await dormir(PAUSA_ENTRE_MS);
  }
}

function iniciarReconciliacaoRegistroSite(client) {
  const tick = () => processar(client).catch((e) => console.error('[reconciliar-site]', e));
  tick();
  setInterval(tick, INTERVALO_MS);
  console.log('🔗 Reconciliação de registro pelo site iniciada (a cada 3min).');
}

module.exports = { iniciarReconciliacaoRegistroSite };
