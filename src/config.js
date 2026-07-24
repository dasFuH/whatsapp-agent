const REQUIRED_VARIABLES = [
  'SUPABASE_URL',
  'SUPABASE_SERVICE_KEY',
  'TARGET_GROUP_JID',
];

function readRequiredVariable(env, name) {
  const value = env[name];
  return typeof value === 'string' ? value.trim() : '';
}

export function loadConfig(env = process.env) {
  const values = Object.fromEntries(
    REQUIRED_VARIABLES.map((name) => [name, readRequiredVariable(env, name)]),
  );
  const missing = REQUIRED_VARIABLES.filter((name) => !values[name]);

  if (missing.length > 0) {
    throw new Error(
      `Konfiguration fehlt: ${missing.join(', ')}. `
      + 'Lege die Werte in .env fest (Vorlage: .env.example).',
    );
  }

  let supabaseUrl;
  try {
    supabaseUrl = new URL(values.SUPABASE_URL);
  } catch {
    throw new Error(
      'SUPABASE_URL muss eine gültige HTTPS-URL sein (Beispiel: https://projekt.supabase.co).',
    );
  }

  if (supabaseUrl.protocol !== 'https:') {
    throw new Error(
      'SUPABASE_URL muss eine gültige HTTPS-URL sein (Beispiel: https://projekt.supabase.co).',
    );
  }

  return Object.freeze({
    supabaseUrl: values.SUPABASE_URL,
    supabaseServiceKey: values.SUPABASE_SERVICE_KEY,
    targetGroupJid: values.TARGET_GROUP_JID,
  });
}
