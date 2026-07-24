import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.js';

test('loadConfig loads and trims the Phase 2 environment', () => {
  const config = loadConfig({
    SUPABASE_URL: ' https://example.supabase.co ',
    SUPABASE_SERVICE_KEY: ' service-role-key ',
    TARGET_GROUP_JID: ' 120363000000000000@g.us ',
  });

  assert.deepEqual(config, {
    supabaseUrl: 'https://example.supabase.co',
    supabaseServiceKey: 'service-role-key',
    targetGroupJid: '120363000000000000@g.us',
  });
  assert.equal(Object.isFrozen(config), true);
});

test('loadConfig reports every missing Phase 2 variable with setup guidance', () => {
  assert.throws(
    () => loadConfig({
      SUPABASE_URL: ' ',
      TARGET_GROUP_JID: '',
    }),
    (error) => {
      assert.match(error.message, /SUPABASE_URL/);
      assert.match(error.message, /SUPABASE_SERVICE_KEY/);
      assert.match(error.message, /TARGET_GROUP_JID/);
      assert.match(error.message, /\.env\.example/);
      return true;
    },
  );
});

test('loadConfig requires an HTTPS Supabase URL', () => {
  assert.throws(
    () => loadConfig({
      SUPABASE_URL: 'http://example.supabase.co',
      SUPABASE_SERVICE_KEY: 'service-role-key',
      TARGET_GROUP_JID: '120363000000000000@g.us',
    }),
    /SUPABASE_URL muss eine gültige HTTPS-URL sein/,
  );
});
