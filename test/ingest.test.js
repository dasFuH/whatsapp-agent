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

function makeSocket() {
  const sent = [];
  return {
    sent,
    async sendMessage(jid, content) {
      sent.push({ jid, content });
    },
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

test('ingestion downloads a buffer, maps UTF-8 fields exactly, persists, then confirms the filename', async () => {
  const message = makeMessage();
  const rows = [];
  const socket = makeSocket();
  const markdown = '# Grüße\nKöln 👋';
  const ingestor = createMessageIngestor({
    targetGroupJid: TARGET_GROUP_JID,
    projectRepository: {
      async upsertProjekt(row) {
        rows.push(row);
      },
    },
    async downloadMedia(receivedMessage, type, options) {
      assert.strictEqual(receivedMessage, message);
      assert.equal(type, 'buffer');
      assert.deepEqual(options, {});
      return Buffer.from(markdown, 'utf-8');
    },
  });

  const result = await ingestor(socket, message);

  const expectedRow = {
    wa_message_id: 'stable-message-id',
    author_name: 'Ada',
    author_jid: '491234567890@s.whatsapp.net',
    raw_md: markdown,
  };
  assert.deepEqual(rows, [expectedRow]);
  assert.deepEqual(result, {
    status: 'ingested',
    fileName: 'projekt.md',
    row: expectedRow,
  });
  assert.deepEqual(socket.sent, [{
    jid: TARGET_GROUP_JID,
    content: { text: '✅ „projekt.md“ erfasst.' },
  }]);
});

test('replaying the same stable message ID obeys the idempotent repository contract', async () => {
  const storedRows = new Map();
  const socket = makeSocket();
  const ingestor = createMessageIngestor({
    targetGroupJid: TARGET_GROUP_JID,
    projectRepository: {
      async upsertProjekt(row) {
        storedRows.set(row.wa_message_id, row);
      },
    },
    async downloadMedia() {
      return Buffer.from('# Gleiches Projekt', 'utf-8');
    },
  });
  const message = makeMessage();

  await ingestor(socket, message);
  await ingestor(socket, message);

  assert.equal(storedRows.size, 1);
  assert.equal(storedRows.get('stable-message-id').wa_message_id, 'stable-message-id');
});

test('ingestion filters the exact target group before downloading', async () => {
  let downloaded = false;
  let persisted = false;
  const socket = makeSocket();
  const ingestor = createMessageIngestor({
    targetGroupJid: TARGET_GROUP_JID,
    projectRepository: {
      async upsertProjekt() {
        persisted = true;
      },
    },
    async downloadMedia() {
      downloaded = true;
      return Buffer.from('not reached');
    },
  });
  const message = makeMessage({
    key: {
      id: 'stable-message-id',
      remoteJid: `${TARGET_GROUP_JID}.other`,
      participant: '491234567890@s.whatsapp.net',
      fromMe: false,
    },
  });

  const result = await ingestor(socket, message);

  assert.deepEqual(result, { status: 'ignored', reason: 'target-group' });
  assert.equal(downloaded, false);
  assert.equal(persisted, false);
  assert.deepEqual(socket.sent, []);
});

test('ingestion accepts only filenames that end in .md', async () => {
  let downloaded = false;
  const socket = makeSocket();
  const ingestor = createMessageIngestor({
    targetGroupJid: TARGET_GROUP_JID,
    projectRepository: {
      async upsertProjekt() {
        throw new Error('not reached');
      },
    },
    async downloadMedia() {
      downloaded = true;
      return Buffer.from('not reached');
    },
  });
  const message = makeMessage({
    message: {
      documentMessage: {
        fileName: 'projekt.md.txt',
      },
    },
  });

  const result = await ingestor(socket, message);

  assert.deepEqual(result, { status: 'ignored', reason: 'not-markdown' });
  assert.equal(downloaded, false);
  assert.deepEqual(socket.sent, []);
});

test('ingestion requires a stable non-empty message ID before downloading', async () => {
  let downloaded = false;
  const socket = makeSocket();
  const ingestor = createMessageIngestor({
    targetGroupJid: TARGET_GROUP_JID,
    projectRepository: {
      async upsertProjekt() {
        throw new Error('not reached');
      },
    },
    async downloadMedia() {
      downloaded = true;
      return Buffer.from('not reached');
    },
  });
  const message = makeMessage({
    key: {
      id: ' ',
      remoteJid: TARGET_GROUP_JID,
      participant: '491234567890@s.whatsapp.net',
      fromMe: false,
    },
  });

  await assert.rejects(
    ingestor(socket, message),
    /keine stabile WhatsApp-Nachrichten-ID/,
  );
  assert.equal(downloaded, false);
  assert.deepEqual(socket.sent, []);
});

test('ingestion sends no confirmation when persistence fails', async () => {
  const databaseError = new Error('database unavailable');
  const socket = makeSocket();
  const ingestor = createMessageIngestor({
    targetGroupJid: TARGET_GROUP_JID,
    projectRepository: {
      async upsertProjekt() {
        throw databaseError;
      },
    },
    async downloadMedia() {
      return Buffer.from('# Nicht gespeichert', 'utf-8');
    },
  });

  await assert.rejects(ingestor(socket, makeMessage()), databaseError);
  assert.deepEqual(socket.sent, []);
});

test('ingestion rejects an oversized trustworthy metadata length before downloading', async () => {
  let downloaded = false;
  const socket = makeSocket();
  const ingestor = createMessageIngestor({
    targetGroupJid: TARGET_GROUP_JID,
    projectRepository: {
      async upsertProjekt() {
        throw new Error('not reached');
      },
    },
    async downloadMedia() {
      downloaded = true;
      return Buffer.from('not reached');
    },
  });
  const message = makeMessage({
    message: {
      documentMessage: {
        fileName: 'gross.md',
        fileLength: MAX_MARKDOWN_BYTES + 1,
      },
    },
  });

  await assert.rejects(
    ingestor(socket, message),
    /überschreitet das Limit/,
  );
  assert.equal(downloaded, false);
  assert.deepEqual(socket.sent, []);
});

test('ingestion enforces downloaded-buffer, size, UTF-8, and NUL-byte boundaries', async (t) => {
  async function expectRejectedDownload(downloadedValue, expectedError) {
    const socket = makeSocket();
    const ingestor = createMessageIngestor({
      targetGroupJid: TARGET_GROUP_JID,
      projectRepository: {
        async upsertProjekt() {
          throw new Error('not reached');
        },
      },
      async downloadMedia() {
        return downloadedValue;
      },
    });

    await assert.rejects(ingestor(socket, makeMessage()), expectedError);
    assert.deepEqual(socket.sent, []);
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
      id: 'foreign-message',
      remoteJid: `${TARGET_GROUP_JID}.foreign`,
      participant: '491234567890@s.whatsapp.net',
      fromMe: false,
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
