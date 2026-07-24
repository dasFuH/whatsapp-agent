import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createProjectRepository } from '../src/db.js';

test('project repository creates a server-only client and upserts by WhatsApp message ID', async () => {
  const calls = {};
  const expectedRow = {
    wa_message_id: 'message-1',
    raw_md: '# Projekt',
  };
  const fakeClient = {
    from(table) {
      calls.table = table;
      return {
        async upsert(row, options) {
          calls.row = row;
          calls.upsertOptions = options;
          return { error: null };
        },
      };
    },
  };

  const repository = createProjectRepository(
    {
      supabaseUrl: 'https://example.supabase.co',
      supabaseServiceKey: 'service-role-key',
    },
    {
      createClient(url, key, options) {
        calls.createClient = { url, key, options };
        return fakeClient;
      },
    },
  );

  await repository.upsertProjekt(expectedRow);

  assert.deepEqual(calls.createClient, {
    url: 'https://example.supabase.co',
    key: 'service-role-key',
    options: {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    },
  });
  assert.equal(calls.table, 'projekte');
  assert.strictEqual(calls.row, expectedRow);
  assert.deepEqual(calls.upsertOptions, { onConflict: 'wa_message_id' });
});

test('project repository surfaces Supabase upsert errors', async () => {
  const databaseError = new Error('database unavailable');
  const repository = createProjectRepository(
    {
      supabaseUrl: 'https://example.supabase.co',
      supabaseServiceKey: 'service-role-key',
    },
    {
      createClient() {
        return {
          from() {
            return {
              async upsert() {
                return { error: databaseError };
              },
            };
          },
        };
      },
    },
  );

  await assert.rejects(repository.upsertProjekt({}), databaseError);
});

test('schema locks project data and RPC access to the service role', async () => {
  const schema = await readFile(new URL('../sql/schema.sql', import.meta.url), 'utf-8');

  assert.match(schema, /alter table public\.projekte enable row level security;/i);
  assert.match(
    schema,
    /revoke all on table public\.projekte from anon, authenticated;/i,
  );
  assert.match(schema, /grant usage on schema public to service_role;/i);
  assert.match(
    schema,
    /grant select, insert, update, delete on table public\.projekte to service_role;/i,
  );
  assert.match(
    schema,
    /grant usage, select on sequence public\.projekte_id_seq to service_role;/i,
  );
  assert.match(
    schema,
    /revoke execute on function public\.suche_projekte\(vector, text, integer\)[\s\S]+from public, anon, authenticated;/i,
  );
  assert.match(
    schema,
    /grant execute on function public\.suche_projekte\(vector, text, integer\)[\s\S]+to service_role;/i,
  );
});
