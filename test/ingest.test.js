import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_MARKDOWN_BYTES,
  createMessageIngestor,
  createMessagesUpsertHandler,
  formatSafeErrorMessage,
  inspectMarkdownDocument,
} from '../src/ingest.js';

const TARGET_GROUP_JID = '120363000000000000@g.us';
const VALID_METADATA = {
  titel: 'Projekt Atlas',
  summary: 'Eine kompakte Projektzusammenfassung.',
  tags: ['node', 'suche'],
  kategorie: 'Automation',
};
const VALID_EMBEDDING = Array.from({ length: 1_024 }, (_, index) => index / 1_024);

function makeMessage(overrides = {}) {
  return {
    key: {
      id: 'stable-message-id',
      remoteJid: TARGET_GROUP_JID,
      participant: '491234567890@s.whatsapp.net',
      fromMe: false,
      ...overrides.key,
    },
    pushName: 'Ada',
    message: {
      documentMessage: {
        fileName: 'projekt.md',
        mimetype: 'application/octet-stream',
      },
    },
    ...overrides,
  };
}

function makeSocket(events = []) {
  const sent = [];
  return {
    sent,
    async sendMessage(jid, content) {
      events.push('send');
      sent.push({ jid, content });
    },
  };
}

function makeHarness(options = {}) {
  const events = [];
  const rows = [];
  const downloads = [];
  const extractions = [];
  const embeddings = [];
  const socket = makeSocket(events);
  const markdown = options.markdown ?? '# Grüße\nKöln 👋';
  const findProjekt = options.findProjekt
    ?? (async () => options.existingRow ?? null);
  const upsertProjekt = options.upsertProjekt
    ?? (async (row) => rows.push(row));
  const downloadMedia = options.downloadMedia
    ?? (async () => Buffer.from(markdown, 'utf-8'));
  const extractMetadata = options.extractMetadata
    ?? (async () => VALID_METADATA);
  const embed = options.embed
    ?? (async () => VALID_EMBEDDING);

  const ingestor = createMessageIngestor({
    targetGroupJid: TARGET_GROUP_JID,
    projectRepository: {
      async findProjektByMessageId(waMessageId) {
        events.push('find');
        return findProjekt(waMessageId);
      },
      async upsertProjekt(row) {
        events.push('upsert');
        return upsertProjekt(row);
      },
    },
    async downloadMedia(message, type, downloadOptions) {
      events.push('download');
      downloads.push({ message, type, options: downloadOptions });
      return downloadMedia(message, type, downloadOptions);
    },
    async extractMetadata(rawMd) {
      events.push('extract');
      extractions.push(rawMd);
      return extractMetadata(rawMd);
    },
    async embed(text, embedOptions) {
      events.push('embed');
      embeddings.push({ text, options: embedOptions });
      return embed(text, embedOptions);
    },
  });

  return {
    ingestor,
    socket,
    events,
    rows,
    downloads,
    extractions,
    embeddings,
    markdown,
  };
}

function completeRow(embedding = VALID_EMBEDDING) {
  return {
    wa_message_id: 'stable-message-id',
    raw_md: '# Bereits gespeichert',
    ...VALID_METADATA,
    embedding,
  };
}

test('document inspection unwraps Baileys content and accepts a case-insensitive .md suffix', () => {
  const message = makeMessage({
    message: {
      ephemeralMessage: {
        message: {
          documentWithCaptionMessage: {
            message: {
              documentMessage: {
                fileName: 'ProjektPlan.MD',
              },
            },
          },
        },
      },
    },
  });

  assert.deepEqual(inspectMarkdownDocument(message), {
    document: {
      fileName: 'ProjektPlan.MD',
    },
    fileName: 'ProjektPlan.MD',
    isMarkdown: true,
  });
});

test('new ingestion preserves Phase 2 media checks, enriches in order, fully persists, then confirms title', async () => {
  const harness = makeHarness({
    extractMetadata: async () => ({
      titel: ' Projekt Atlas ',
      summary: ' Eine kompakte Projektzusammenfassung. ',
      tags: [' node ', 'suche'],
      kategorie: ' Automation ',
    }),
  });
  const message = makeMessage();

  const result = await harness.ingestor(harness.socket, message);

  const expectedRow = {
    wa_message_id: 'stable-message-id',
    author_name: 'Ada',
    author_jid: '491234567890@s.whatsapp.net',
    raw_md: harness.markdown,
    ...VALID_METADATA,
    embedding: VALID_EMBEDDING,
  };
  assert.deepEqual(harness.events, [
    'find',
    'download',
    'extract',
    'embed',
    'upsert',
    'send',
  ]);
  assert.deepEqual(harness.downloads, [{
    message,
    type: 'buffer',
    options: {},
  }]);
  assert.deepEqual(harness.extractions, [harness.markdown]);
  assert.deepEqual(harness.embeddings, [{
    text: `${VALID_METADATA.titel}\n${VALID_METADATA.summary}`,
    options: { inputType: 'document' },
  }]);
  assert.deepEqual(harness.rows, [expectedRow]);
  assert.deepEqual(result, {
    status: 'ingested',
    fileName: 'projekt.md',
    row: expectedRow,
  });
  assert.deepEqual(harness.socket.sent, [{
    jid: TARGET_GROUP_JID,
    content: { text: '✅ „Projekt Atlas“ erfasst.' },
  }]);
});

test('confirmation sanitizes the recognized title and happens only after successful new-row persistence', async () => {
  const harness = makeHarness({
    extractMetadata: async () => ({
      ...VALID_METADATA,
      titel: `Atlas\r\n\u0000${'x'.repeat(200)}`,
    }),
  });

  await assert.rejects(
    harness.ingestor(harness.socket, makeMessage()),
    /titel ist leer oder zu lang/,
  );
  assert.deepEqual(harness.rows, []);
  assert.deepEqual(harness.socket.sent, []);

  const safeHarness = makeHarness({
    extractMetadata: async () => ({
      ...VALID_METADATA,
      titel: 'Atlas\r\n\u0000Projekt',
    }),
  });
  await safeHarness.ingestor(safeHarness.socket, makeMessage());

  assert.equal(safeHarness.events.at(-1), 'send');
  assert.deepEqual(safeHarness.socket.sent, [{
    jid: TARGET_GROUP_JID,
    content: { text: '✅ „Atlas Projekt“ erfasst.' },
  }]);
});

test('a complete replay skips download, paid providers, persistence, and confirmation', async (t) => {
  const pgvector = `[${Array(1_024).fill('0.25').join(',')}]`;

  for (const [name, existingRow] of [
    ['numeric array', completeRow(VALID_EMBEDDING)],
    ['pgvector string', completeRow(pgvector)],
    ['null raw_md', { ...completeRow(VALID_EMBEDDING), raw_md: null }],
    ['blank raw_md', { ...completeRow(VALID_EMBEDDING), raw_md: ' ' }],
  ]) {
    await t.test(name, async () => {
      const harness = makeHarness({ existingRow });

      const result = await harness.ingestor(harness.socket, makeMessage());

      assert.deepEqual(result, { status: 'already-ingested', row: existingRow });
      assert.deepEqual(harness.events, ['find']);
      assert.deepEqual(harness.rows, []);
      assert.deepEqual(harness.downloads, []);
      assert.deepEqual(harness.extractions, []);
      assert.deepEqual(harness.embeddings, []);
      assert.deepEqual(harness.socket.sent, []);
    });
  }
});

test('replaying a newly persisted stable message ID performs no second paid or confirmation call', async () => {
  let storedRow = null;
  const harness = makeHarness({
    findProjekt: async () => storedRow,
    upsertProjekt: async (row) => {
      storedRow = row;
      harness.rows.push(row);
    },
  });
  const message = makeMessage();

  await harness.ingestor(harness.socket, message);
  const result = await harness.ingestor(harness.socket, message);

  assert.equal(result.status, 'already-ingested');
  assert.equal(harness.rows.length, 1);
  assert.equal(harness.downloads.length, 1);
  assert.equal(harness.extractions.length, 1);
  assert.equal(harness.embeddings.length, 1);
  assert.equal(harness.socket.sent.length, 1);
});

test('an incomplete Phase 2 row reuses raw_md, enriches only allowed fields, and stays silent', async () => {
  const existingRow = {
    wa_message_id: 'stable-message-id',
    raw_md: '# Gespeicherter Rohtext',
    titel: null,
    summary: null,
    tags: null,
    kategorie: null,
    embedding: null,
    author_name: 'Historisch',
    status: 'vergeben',
    claimed_by: 'Bob',
    created_at: '2026-07-01T00:00:00Z',
  };
  const harness = makeHarness({ existingRow });

  const result = await harness.ingestor(harness.socket, makeMessage());

  const expectedEnrichment = {
    wa_message_id: 'stable-message-id',
    ...VALID_METADATA,
    embedding: VALID_EMBEDDING,
  };
  assert.deepEqual(harness.events, ['find', 'extract', 'embed', 'upsert']);
  assert.deepEqual(harness.downloads, []);
  assert.deepEqual(harness.extractions, [existingRow.raw_md]);
  assert.deepEqual(harness.embeddings, [{
    text: `${VALID_METADATA.titel}\n${VALID_METADATA.summary}`,
    options: { inputType: 'document' },
  }]);
  assert.deepEqual(harness.rows, [expectedEnrichment]);
  assert.deepEqual(Object.keys(harness.rows[0]), [
    'wa_message_id',
    'titel',
    'summary',
    'tags',
    'kategorie',
    'embedding',
  ]);
  assert.deepEqual(result, { status: 'enriched', row: expectedEnrichment });
  assert.deepEqual(harness.socket.sent, []);
});

test('valid stored metadata is reused when only embedding is absent', async () => {
  const existingRow = {
    wa_message_id: 'stable-message-id',
    raw_md: '# Gespeicherter Rohtext',
    titel: ' Projekt Atlas ',
    summary: ' Eine kompakte Projektzusammenfassung. ',
    tags: [' node ', 'suche'],
    kategorie: ' Automation ',
    embedding: null,
  };
  const harness = makeHarness({
    existingRow,
    extractMetadata: async () => {
      throw new Error('LLM must not be called');
    },
  });

  await harness.ingestor(harness.socket, makeMessage());

  assert.deepEqual(harness.events, ['find', 'embed', 'upsert']);
  assert.deepEqual(harness.extractions, []);
  assert.deepEqual(harness.embeddings, [{
    text: `${VALID_METADATA.titel}\n${VALID_METADATA.summary}`,
    options: { inputType: 'document' },
  }]);
  assert.deepEqual(harness.rows, [{
    wa_message_id: 'stable-message-id',
    ...VALID_METADATA,
    embedding: VALID_EMBEDDING,
  }]);
  assert.deepEqual(harness.socket.sent, []);
});

test('an existing row without reusable raw_md fails before download, providers, or persistence', async () => {
  const harness = makeHarness({
    existingRow: {
      ...completeRow(null),
      raw_md: ' ',
    },
  });

  await assert.rejects(
    harness.ingestor(harness.socket, makeMessage()),
    /kein wiederverwendbares Markdown/,
  );
  assert.deepEqual(harness.events, ['find']);
  assert.deepEqual(harness.rows, []);
  assert.deepEqual(harness.socket.sent, []);
});

test('provider and metadata failures never persist partial data or confirm', async (t) => {
  await t.test('metadata provider failure', async () => {
    const providerError = new Error('Anthropic unavailable');
    const harness = makeHarness({
      extractMetadata: async () => {
        throw providerError;
      },
    });

    await assert.rejects(harness.ingestor(harness.socket, makeMessage()), providerError);
    assert.deepEqual(harness.events, ['find', 'download', 'extract']);
    assert.deepEqual(harness.rows, []);
    assert.deepEqual(harness.socket.sent, []);
  });

  await t.test('invalid metadata including an extra key', async () => {
    const harness = makeHarness({
      extractMetadata: async () => ({
        ...VALID_METADATA,
        secret: 'unexpected',
      }),
    });

    await assert.rejects(
      harness.ingestor(harness.socket, makeMessage()),
      /unerwartete oder fehlende Felder/,
    );
    assert.deepEqual(harness.events, ['find', 'download', 'extract']);
    assert.deepEqual(harness.rows, []);
    assert.deepEqual(harness.socket.sent, []);
  });

  await t.test('embedding provider failure', async () => {
    const providerError = new Error('Voyage unavailable');
    const harness = makeHarness({
      embed: async () => {
        throw providerError;
      },
    });

    await assert.rejects(harness.ingestor(harness.socket, makeMessage()), providerError);
    assert.deepEqual(harness.events, ['find', 'download', 'extract', 'embed']);
    assert.deepEqual(harness.rows, []);
    assert.deepEqual(harness.socket.sent, []);
  });
});

test('ingestion sends no confirmation when persistence fails', async () => {
  const databaseError = new Error('database unavailable');
  const harness = makeHarness({
    upsertProjekt: async () => {
      throw databaseError;
    },
  });

  await assert.rejects(harness.ingestor(harness.socket, makeMessage()), databaseError);
  assert.deepEqual(harness.events, ['find', 'download', 'extract', 'embed', 'upsert']);
  assert.deepEqual(harness.socket.sent, []);
});

test('ingestion filters from-me, exact target group, and Markdown suffix before lookup or download', async (t) => {
  const cases = [
    ['from me', makeMessage({ key: { ...makeMessage().key, fromMe: true } }), 'from-me'],
    ['wrong group', makeMessage({
      key: {
        ...makeMessage().key,
        remoteJid: `${TARGET_GROUP_JID}.other`,
      },
    }), 'target-group'],
    ['wrong suffix', makeMessage({
      message: {
        documentMessage: {
          fileName: 'projekt.md.txt',
        },
      },
    }), 'not-markdown'],
  ];

  for (const [name, message, reason] of cases) {
    await t.test(name, async () => {
      const harness = makeHarness();
      assert.deepEqual(
        await harness.ingestor(harness.socket, message),
        { status: 'ignored', reason },
      );
      assert.deepEqual(harness.events, []);
      assert.deepEqual(harness.socket.sent, []);
    });
  }
});

test('ingestion requires a stable non-empty message ID before lookup or download', async () => {
  const harness = makeHarness();
  const message = makeMessage({
    key: {
      ...makeMessage().key,
      id: ' ',
    },
  });

  await assert.rejects(
    harness.ingestor(harness.socket, message),
    /keine stabile WhatsApp-Nachrichten-ID/,
  );
  assert.deepEqual(harness.events, []);
  assert.deepEqual(harness.socket.sent, []);
});

test('ingestion rejects an oversized trustworthy metadata length before downloading', async () => {
  const harness = makeHarness();
  const message = makeMessage({
    message: {
      documentMessage: {
        fileName: 'gross.md',
        fileLength: MAX_MARKDOWN_BYTES + 1,
      },
    },
  });

  await assert.rejects(
    harness.ingestor(harness.socket, message),
    /überschreitet das Limit/,
  );
  assert.deepEqual(harness.events, ['find']);
  assert.deepEqual(harness.downloads, []);
  assert.deepEqual(harness.socket.sent, []);
});

test('ingestion enforces downloaded-buffer, size, UTF-8, and NUL-byte boundaries', async (t) => {
  async function expectRejectedDownload(downloadedValue, expectedError) {
    const harness = makeHarness({
      downloadMedia: async () => downloadedValue,
    });

    await assert.rejects(
      harness.ingestor(harness.socket, makeMessage()),
      expectedError,
    );
    assert.deepEqual(harness.events, ['find', 'download']);
    assert.deepEqual(harness.rows, []);
    assert.deepEqual(harness.socket.sent, []);
  }

  await t.test('requires a Buffer', async () => {
    await expectRejectedDownload(new Uint8Array([35]), /keinen Buffer/);
  });

  await t.test('checks actual downloaded size', async () => {
    await expectRejectedDownload(
      Buffer.alloc(MAX_MARKDOWN_BYTES + 1, 0x61),
      /überschreitet das Limit/,
    );
  });

  await t.test('uses fatal UTF-8 decoding', async () => {
    await expectRejectedDownload(
      Buffer.from([0xc3, 0x28]),
      /kein gültiges UTF-8/,
    );
  });

  await t.test('rejects NUL bytes', async () => {
    await expectRejectedDownload(
      Buffer.from('# Projekt\0versteckt', 'utf-8'),
      /NUL-Bytes/,
    );
  });
});

test('messages handler filters the exact group before inspecting or logging', async () => {
  const logs = [];
  let ingested = false;
  const handler = createMessagesUpsertHandler({
    sock: makeSocket(),
    targetGroupJid: TARGET_GROUP_JID,
    async ingestMessage() {
      ingested = true;
    },
    log(value) {
      logs.push(value);
    },
  });
  const foreignMessage = makeMessage({
    key: {
      ...makeMessage().key,
      id: 'foreign-message',
      remoteJid: `${TARGET_GROUP_JID}.foreign`,
    },
  });

  await handler({ messages: [foreignMessage] });

  assert.equal(ingested, false);
  assert.deepEqual(logs, []);
});

test('messages handler bounds and sanitizes untrusted log fields without logging a JID', async () => {
  const logs = [];
  const handler = createMessagesUpsertHandler({
    sock: makeSocket(),
    targetGroupJid: TARGET_GROUP_JID,
    async ingestMessage() {},
    log(value) {
      logs.push(value);
    },
  });
  const message = makeMessage({
    pushName: `Ada\nAdmin\u0000${'x'.repeat(160)}`,
    message: {
      documentMessage: {
        fileName: `Plan\r\n${'y'.repeat(160)}.MD`,
      },
    },
  });

  await handler({ messages: [message] });

  assert.equal(logs.length, 1);
  assert.equal(Object.hasOwn(logs[0], 'jid'), false);
  assert.doesNotMatch(logs[0].from, /[\u0000-\u001f\u007f-\u009f]/);
  assert.doesNotMatch(logs[0].file, /[\u0000-\u001f\u007f-\u009f]/);
  assert.ok(logs[0].from.length <= 96);
  assert.ok(logs[0].file.length <= 96);
});

test('messages handler logs only a bounded safe error message and continues', async () => {
  const errors = [];
  let attempts = 0;
  const handler = createMessagesUpsertHandler({
    sock: makeSocket(),
    targetGroupJid: TARGET_GROUP_JID,
    async ingestMessage() {
      attempts += 1;
      throw new Error(`Fehler\n${'sensitive-detail '.repeat(30)}`);
    },
    log() {},
    logError(value) {
      errors.push(value);
    },
  });

  await handler({
    messages: [
      makeMessage({ key: { ...makeMessage().key, id: `id\n${'x'.repeat(100)}` } }),
      makeMessage({ key: { ...makeMessage().key, id: 'second-id' } }),
    ],
  });

  assert.equal(attempts, 2);
  assert.equal(errors.length, 2);
  for (const error of errors) {
    assert.equal(typeof error, 'string');
    assert.doesNotMatch(error, /[\r\n\u0000]/);
    assert.ok(error.length <= 240);
  }
});

test('safe error formatting is bounded and strips control characters', () => {
  const formatted = formatSafeErrorMessage(
    new Error(`Start fehlgeschlagen\r\n\u0000${'detail '.repeat(80)}`),
  );

  assert.doesNotMatch(formatted, /[\u0000-\u001f\u007f-\u009f]/);
  assert.ok(formatted.length <= 160);
  assert.equal(formatSafeErrorMessage({}), 'Unbekannter Fehler');
});
