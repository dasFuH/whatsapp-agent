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
    async upsertProjekt(row) {
      const { error } = await supabase
        .from('projekte')
        .upsert(row, { onConflict: 'wa_message_id' });

      if (error) throw error;
    },
  });
}
