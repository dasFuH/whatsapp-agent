import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_QUERY_CHARS,
  SEARCH_RESULT_LIMIT,
  createCommandHandler,
  extractCommand,
  formatSearchResults,
} from '../src/commands.js';

const TARGET_GROUP_JID = '120363000000000000@g.us';
const QUERY_EMBEDDING = Array.from({ length: 1_024 }, (_, index) => index / 1_024);

function makeTextMessage(text, overrides = {}) {
  return {
    key: {
      id: 'stable-message-id',
      remoteJid: TARGET_GROUP_JID,
      participant: '491234567890@s.whatsapp.net',
      fromMe: false,
      ...overrides.key,
    },
    pushName: 'Ada',
    message: { conversation: text },
    ...overrides,
  };
}

function makeHarness(options = {}) {
  const events = [];
  const searches = [];
  const embeddings = [];
  const sent = [];
  const embed = options.embed ?? (async () => QUERY_EMBEDDING);
  const searchProjekte = options.searchProjekte ?? (async () => options.results ?? []);

  const handleCommand = createCommandHandler({
    targetGroupJid: TARGET_GROUP_JID,
    projectRepository: {
      async searchProjekte(request) {
        events.push('search');
        searches.push(request);
        return searchProjekte(request);
      },
    },
    async embed(text, embedOptions) {
      events.push('embed');
      embeddings.push({ text, options: embedOptions });
      return embed(text, embedOptions);
    },
  });

  return {
    handleCommand,
    events,
    searches,
    embeddings,
    socket: {
      async sendMessage(jid, content) {
        events.push('send');
        sent.push({ jid, content });
      },
    },
    sent,
  };
}

test('command parsing unwraps text content and normalizes name and argument', async (t) => {
  const cases = [
    ['plain conversation', { conversation: '/suche puzzle game' }, { name: 'suche', argument: 'puzzle game' }],
    ['extended text', {
      extendedTextMessage: { text: '/suche puzzle game' },
    }, { name: 'suche', argument: 'puzzle game' }],
    ['ephemeral wrapper', {
      ephemeralMessage: { message: { conversation: '/Suche  Puzzle Game  ' } },
    }, { name: 'suche', argument: 'Puzzle Game' }],
    ['surrounding whitespace', { conversation: '  /suche puzzle  ' }, { name: 'suche', argument: 'puzzle' }],
    ['no argument', { conversation: '/suche' }, { name: 'suche', argument: '' }],
    ['argument keeps inner spacing', { conversation: '/suche a  b' }, { name: 'suche', argument: 'a  b' }],
    ['future command', { conversation: '/nehmen 42' }, { name: 'nehmen', argument: '42' }],
  ];

  for (const [name, content, expected] of cases) {
    await t.test(name, () => {
      assert.deepEqual(extractCommand({ message: content }), expected);
    });
  }
});

test('command parsing rejects non-commands and unsafe command names', async (t) => {
  const cases = [
    ['no message', undefined],
    ['empty conversation', { conversation: '   ' }],
    ['plain text', { conversation: 'kein Befehl' }],
    ['slash inside text', { conversation: 'siehe /suche' }],
    ['bare slash', { conversation: '/' }],
    ['slash with space', { conversation: '/ suche' }],
    ['emoji name', { conversation: '/💥 test' }],
    ['name with punctuation', { conversation: '/suche! test' }],
    ['document caption stays ingest', {
      documentMessage: { fileName: 'projekt.md', caption: '/suche puzzle' },
    }],
    ['oversized name', { conversation: `/${'x'.repeat(33)} test` }],
  ];

  for (const [name, content] of cases) {
    await t.test(name, () => {
      assert.equal(extractCommand(content === undefined ? {} : { message: content }), null);
    });
  }
});

test('/suche embeds the query, calls the RPC, and returns the top five hits', async () => {
  const results = [
    { id: 7, status: 'frei', titel: 'Puzzle Trainer' },
    { id: '8', status: 'vergeben', titel: 'Sudoku Solver' },
  ];
  const harness = makeHarness({ results });

  const result = await harness.handleCommand(
    harness.socket,
    makeTextMessage('/suche puzzle game'),
  );

  assert.deepEqual(harness.events, ['embed', 'search', 'send']);
  assert.deepEqual(harness.embeddings, [{
    text: 'puzzle game',
    options: { inputType: 'query' },
  }]);
  assert.deepEqual(harness.searches, [{
    embedding: QUERY_EMBEDDING,
    queryText: 'puzzle game',
    treffer: 5,
  }]);
  assert.equal(SEARCH_RESULT_LIMIT, 5);
  assert.deepEqual(harness.sent, [{
    jid: TARGET_GROUP_JID,
    content: { text: '#7 [frei] Puzzle Trainer\n#8 [vergeben] Sudoku Solver' },
  }]);
  assert.deepEqual(result, { status: 'searched', command: 'suche', results });
});

test('/suche reports no hits without inventing results', async () => {
  const harness = makeHarness({ results: [] });

  await harness.handleCommand(harness.socket, makeTextMessage('/suche puzzle game'));

  assert.deepEqual(harness.sent, [{
    jid: TARGET_GROUP_JID,
    content: { text: 'Nichts gefunden.' },
  }]);
});

test('result formatting bounds the list and drops rows without a usable id or title', () => {
  const rows = Array.from({ length: 8 }, (_, index) => ({
    id: index + 1,
    status: 'frei',
    titel: `Projekt ${index + 1}`,
  }));

  assert.equal(formatSearchResults(rows).split('\n').length, SEARCH_RESULT_LIMIT);
  assert.equal(
    formatSearchResults([
      { id: 0, status: 'frei', titel: 'Ungültige ID' },
      { id: -3, status: 'frei', titel: 'Negative ID' },
      { id: 1.5, status: 'frei', titel: 'Keine Ganzzahl' },
      { id: 'abc', status: 'frei', titel: 'Text-ID' },
      { id: null, status: 'frei', titel: 'Fehlende ID' },
      { id: 4, status: 'frei', titel: '  ' },
      { id: 5, status: 'frei' },
    ]),
    'Nichts gefunden.',
  );
  assert.equal(formatSearchResults(null), 'Nichts gefunden.');
  assert.equal(formatSearchResults(undefined), 'Nichts gefunden.');
});

test('result formatting sanitizes and bounds untrusted title and status values', () => {
  const formatted = formatSearchResults([{
    id: 42,
    status: `vergeben\r\n\u0000${'s'.repeat(80)}`,
    titel: `Atlas\r\n\u0000${'x'.repeat(300)}`,
  }]);

  assert.equal(
    formatted,
    `#42 [vergeben ${'s'.repeat(22)}…] Atlas ${'x'.repeat(153)}…`,
  );
  assert.equal(
    formatSearchResults([{ id: 42, status: null, titel: 'Atlas' }]),
    '#42 [(unbekannt)] Atlas',
  );
});

test('/suche rejects an empty or oversized query before any paid call', async (t) => {
  await t.test('empty query', async () => {
    const harness = makeHarness();

    const result = await harness.handleCommand(harness.socket, makeTextMessage('/suche   '));

    assert.deepEqual(result, { status: 'rejected', command: 'suche', reason: 'empty-query' });
    assert.deepEqual(harness.events, ['send']);
    assert.deepEqual(harness.sent, [{
      jid: TARGET_GROUP_JID,
      content: { text: 'Nutzung: /suche <suchbegriff>' },
    }]);
  });

  await t.test('oversized query', async () => {
    const harness = makeHarness();

    const result = await harness.handleCommand(
      harness.socket,
      makeTextMessage(`/suche ${'x'.repeat(MAX_QUERY_CHARS + 1)}`),
    );

    assert.deepEqual(result, { status: 'rejected', command: 'suche', reason: 'query-too-long' });
    assert.deepEqual(harness.events, ['send']);
    assert.deepEqual(harness.sent, [{
      jid: TARGET_GROUP_JID,
      content: { text: 'Suchbegriff ist zu lang (höchstens 500 Zeichen).' },
    }]);
  });

  await t.test('query at the limit is accepted', async () => {
    const harness = makeHarness({ results: [] });

    const result = await harness.handleCommand(
      harness.socket,
      makeTextMessage(`/suche ${'x'.repeat(MAX_QUERY_CHARS)}`),
    );

    assert.equal(result.status, 'searched');
    assert.deepEqual(harness.events, ['embed', 'search', 'send']);
  });
});

test('command handling consumes unknown commands silently and without paid calls', async () => {
  const harness = makeHarness();

  const result = await harness.handleCommand(harness.socket, makeTextMessage('/liste frei'));

  assert.deepEqual(result, { status: 'unknown-command', command: 'liste' });
  assert.deepEqual(harness.events, []);
  assert.deepEqual(harness.sent, []);
});

test('command handling ignores own messages, foreign chats, and non-commands', async (t) => {
  const cases = [
    ['from me', makeTextMessage('/suche puzzle', {
      key: { ...makeTextMessage('x').key, fromMe: true },
    }), 'from-me'],
    ['wrong group', makeTextMessage('/suche puzzle', {
      key: { ...makeTextMessage('x').key, remoteJid: `${TARGET_GROUP_JID}.other` },
    }), 'target-group'],
    ['missing jid', makeTextMessage('/suche puzzle', {
      key: { ...makeTextMessage('x').key, remoteJid: undefined },
    }), 'target-group'],
    ['plain text', makeTextMessage('einfach nur Text'), 'not-a-command'],
  ];

  for (const [name, message, reason] of cases) {
    await t.test(name, async () => {
      const harness = makeHarness();

      assert.deepEqual(
        await harness.handleCommand(harness.socket, message),
        { status: 'ignored', reason },
      );
      assert.deepEqual(harness.events, []);
      assert.deepEqual(harness.sent, []);
    });
  }
});

test('/suche reports a static failure and never leaks provider or database details', async (t) => {
  await t.test('embedding failure skips the RPC', async () => {
    const providerError = new Error('Voyage unavailable: key voyage-secret');
    const harness = makeHarness({
      embed: async () => {
        throw providerError;
      },
    });

    await assert.rejects(
      harness.handleCommand(harness.socket, makeTextMessage('/suche puzzle')),
      providerError,
    );
    assert.deepEqual(harness.events, ['embed', 'send']);
    assert.deepEqual(harness.searches, []);
    assert.deepEqual(harness.sent, [{
      jid: TARGET_GROUP_JID,
      content: { text: 'Die Suche ist gerade nicht möglich.' },
    }]);
  });

  await t.test('search failure', async () => {
    const databaseError = new Error('rpc unavailable: service-role-key');
    const harness = makeHarness({
      searchProjekte: async () => {
        throw databaseError;
      },
    });

    await assert.rejects(
      harness.handleCommand(harness.socket, makeTextMessage('/suche puzzle')),
      databaseError,
    );
    assert.deepEqual(harness.events, ['embed', 'search', 'send']);
    assert.deepEqual(harness.sent, [{
      jid: TARGET_GROUP_JID,
      content: { text: 'Die Suche ist gerade nicht möglich.' },
    }]);
  });
});

test('command handler rejects an incomplete configuration', () => {
  const projectRepository = { async searchProjekte() { return []; } };
  const embed = async () => QUERY_EMBEDDING;

  assert.throws(
    () => createCommandHandler({ targetGroupJid: ' ', projectRepository, embed }),
    /targetGroupJid darf nicht leer sein/,
  );
  assert.throws(
    () => createCommandHandler({ targetGroupJid: TARGET_GROUP_JID, projectRepository: {}, embed }),
    /searchProjekte muss eine Funktion sein/,
  );
  assert.throws(
    () => createCommandHandler({ targetGroupJid: TARGET_GROUP_JID, projectRepository }),
    /embed muss eine Funktion sein/,
  );
});
