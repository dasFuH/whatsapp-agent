import { createClient } from '@supabase/supabase-js';

export function createProjectRepository(config, dependencies = {}) {
  const clientFactory = dependencies.createClient ?? createClient;
  const supabase = clientFactory(
    config.supabaseUrl,
    config.supabaseServiceKey,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  );

  return Object.freeze({
    async findProjektByMessageId(waMessageId) {
      const { data, error } = await supabase
        .from('projekte')
        .select('wa_message_id,raw_md,titel,summary,tags,kategorie,embedding')
        .eq('wa_message_id', waMessageId)
        .maybeSingle();

      if (error) throw error;
      return data;
    },

    async upsertProjekt(row) {
      const { error } = await supabase
        .from('projekte')
        .upsert(row, { onConflict: 'wa_message_id' });

      if (error) throw error;
    },
  });
}
