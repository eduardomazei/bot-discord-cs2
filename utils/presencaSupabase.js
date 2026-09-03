// Leitura da lista de presença que agora mora no site (trupe-site, tabelas presenca_listas /
// presenca_confirmacoes — migração 0009). O bot lê daqui pro /sortear origem:presenca.
//
// Só titulares: os primeiros `capacidade` da ordem de confirmação (mesma regra do site e do
// comportamento antigo do bot, que nunca sorteava a reserva).
const { getSupabase } = require('./supabase');

async function getTitularesListaAberta() {
  const sb = getSupabase();

  const { data: lista, error: e1 } = await sb
    .from('presenca_listas')
    .select('id, titulo, capacidade, data_mix')
    .eq('aberta', true)
    .maybeSingle();
  if (e1) throw new Error(e1.message);
  if (!lista) return { lista: null, titulares: [] };

  const { data: confs, error: e2 } = await sb
    .from('presenca_confirmacoes')
    .select('discord_id, confirmada_em')
    .eq('lista_id', lista.id)
    .order('confirmada_em', { ascending: true });
  if (e2) throw new Error(e2.message);

  return {
    lista,
    titulares: (confs || []).slice(0, lista.capacidade).map((c) => c.discord_id),
  };
}

module.exports = { getTitularesListaAberta };
