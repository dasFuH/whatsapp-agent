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

test('project repository looks up one project by message ID with the minimal Phase 3 fields', async () => {
  const calls = [];
  const expectedRow = {
    wa_message_id: 'message-1',
    raw_md: '# Projekt',
    titel: null,
    summary: null,
    tags: null,
    kategorie: null,
    embedding: null,
  };
  const repository = createProjectRepository(
    {
      supabaseUrl: 'https://example.supabase.co',
      supabaseServiceKey: 'service-role-key',
    },
    {
      createClient() {
        return {
          from(table) {
            calls.push(['from', table]);
            return {
              select(columns) {
                calls.push(['select', columns]);
                return {
                  eq(column, value) {
                    calls.push(['eq', column, value]);
                    return {
                      async maybeSingle() {
                        calls.push(['maybeSingle']);
                        return { data: expectedRow, error: null };
                      },
                    };
                  },
                };
              },
            };
          },
        };
      },
    },
  );

  const row = await repository.findProjektByMessageId('message-1');

  assert.strictEqual(row, expectedRow);
  assert.deepEqual(calls, [
    ['from', 'projekte'],
    ['select', 'wa_message_id,raw_md,titel,summary,tags,kategorie,embedding'],
    ['eq', 'wa_message_id', 'message-1'],
    ['maybeSingle'],
  ]);
});

test('project repository returns null for no lookup match and surfaces lookup errors', async (t) => {
  function makeRepository(result) {
    return createProjectRepository(
      {
        supabaseUrl: 'https://example.supabase.co',
        supabaseServiceKey: 'service-role-key',
      },
      {
        createClient() {
          return {
            from() {
              return {
                select() {
                  return {
                    eq() {
                      return {
                        async maybeSingle() {
                          return result;
                        },
                      };
                    },
                  };
                },
              };
            },
          };
        },
      },
    );
  }

  await t.test('returns null', async () => {
    assert.equal(
      await makeRepository({ data: null, error: null })
        .findProjektByMessageId('missing'),
      null,
    );
  });

  await t.test('surfaces errors', async () => {
    const databaseError = new Error('lookup unavailable');
    await assert.rejects(
      makeRepository({ data: null, error: databaseError })
        .findProjektByMessageId('message-1'),
      databaseError,
    );
  });
});

test('project repository calls the search RPC with the query vector and minimal columns', async () => {
  const calls = [];
  const expectedRows = [{ id: 7, status: 'frei', titel: 'Puzzle Trainer' }];
  const embedding = Array.from({ length: 1_024 }, (_, index) => index / 1_024);
  const repository = createProjectRepository(
    {
      supabaseUrl: 'https://example.supabase.co',
      supabaseServiceKey: 'service-role-key',
    },
    {
      createClient() {
        return {
          rpc(name, params) {
            calls.push(['rpc', name, params]);
            return {
              async select(columns) {
                calls.push(['select', columns]);
                return { data: expectedRows, error: null };
              },
            };
          },
        };
      },
    },
  );

  const rows = await repository.searchProjekte({
    embedding,
    queryText: 'puzzle game',
    treffer: 5,
  });

  assert.strictEqual(rows, expectedRows);
  assert.deepEqual(calls, [
    ['rpc', 'suche_projekte', {
      query_embedding: embedding,
      query_text: 'puzzle game',
      treffer: 5,
    }],
    ['select', 'id,status,titel'],
  ]);
});

test('project repository normalizes empty search results and surfaces RPC errors', async (t) => {
  function makeRepository(result) {
    return createProjectRepository(
      {
        supabaseUrl: 'https://example.supabase.co',
        supabaseServiceKey: 'service-role-key',
      },
      {
        createClient() {
          return {
            rpc() {
              return {
                async select() {
                  return result;
                },
              };
            },
          };
        },
      },
    );
  }

  await t.test('missing data becomes an empty list', async () => {
    assert.deepEqual(
      await makeRepository({ data: null, error: null }).searchProjekte({}),
      [],
    );
  });

  await t.test('surfaces errors', async () => {
    const databaseError = new Error('rpc unavailable');
    await assert.rejects(
      makeRepository({ data: null, error: databaseError }).searchProjekte({}),
      databaseError,
    );
  });
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
