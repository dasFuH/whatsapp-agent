import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_METADATA_INPUT_CHARS,
  MAX_METADATA_OUTPUT_TOKENS,
  METADATA_MODEL,
  createMetadataExtractor,
  normalizeMetadata,
} from '../src/llm.js';

const VALID_METADATA = {
  titel: 'Projekt Atlas',
  summary: 'Eine kompakte Projektzusammenfassung.',
  tags: ['node', 'suche'],
  kategorie: 'Automation',
};

function makeClient(response, calls = []) {
  return {
    messages: {
      async create(request) {
        calls.push(request);
        return response;
      },
    },
  };
}

function makeResponse(overrides = {}) {
  return {
    stop_reason: 'end_turn',
    content: [
      { type: 'thinking', thinking: 'intern' },
      { type: 'text', text: JSON.stringify(VALID_METADATA) },
    ],
    ...overrides,
  };
}

test('metadata extractor sends the exact bounded GA structured-output request and allowlists output', async () => {
  const calls = [];
  const extractor = createMetadataExtractor(
    { apiKey: 'anthropic-secret' },
    {
      client: makeClient(makeResponse({
        content: [
          { type: 'thinking', thinking: 'intern' },
          {
            type: 'text',
            text: JSON.stringify({
              titel: '  Projekt Atlas ',
              summary: ' Eine kompakte Projektzusammenfassung. ',
              tags: [' node ', 'suche'],
              kategorie: ' Automation ',
            }),
          },
        ],
      }), calls),
    },
  );
  const markdown = 'x'.repeat(MAX_METADATA_INPUT_CHARS + 50);

  const metadata = await extractor(markdown);

  assert.deepEqual(metadata, VALID_METADATA);
  assert.deepEqual(Object.keys(metadata), ['titel', 'summary', 'tags', 'kategorie']);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, METADATA_MODEL);
  assert.equal(calls[0].model, 'claude-fable-5');
  assert.equal(calls[0].max_tokens, MAX_METADATA_OUTPUT_TOKENS);
  assert.equal(calls[0].max_tokens, 8_192);
  assert.equal(typeof calls[0].system, 'string');
  assert.deepEqual(calls[0].messages, [{
    role: 'user',
    content: markdown.slice(0, MAX_METADATA_INPUT_CHARS),
  }]);
  assert.deepEqual(calls[0].output_config, {
    effort: 'low',
    format: {
      type: 'json_schema',
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['titel', 'summary', 'tags', 'kategorie'],
        properties: {
          titel: { type: 'string', minLength: 1, maxLength: 200 },
          summary: { type: 'string', minLength: 1, maxLength: 1_000 },
          tags: {
            type: 'array',
            minItems: 1,
            maxItems: 12,
            items: { type: 'string', minLength: 1, maxLength: 64 },
          },
          kategorie: { type: 'string', minLength: 1, maxLength: 100 },
        },
      },
    },
  });
});

test('metadata extractor finds a later non-empty text block without assuming content[0]', async () => {
  const extractor = createMetadataExtractor(
    { apiKey: 'anthropic-secret' },
    {
      client: makeClient(makeResponse({
        content: [
          { type: 'tool_use', id: 'ignored' },
          { type: 'text', text: ' ' },
          { type: 'text', text: JSON.stringify(VALID_METADATA) },
        ],
      })),
    },
  );

  assert.deepEqual(await extractor('# Projekt'), VALID_METADATA);
});

test('metadata extractor fails closed for provider completion and response failures', async (t) => {
  async function expectFailure(response, expected) {
    let calls = 0;
    const extractor = createMetadataExtractor(
      { apiKey: 'anthropic-secret' },
      {
        client: {
          messages: {
            async create() {
              calls += 1;
              return response;
            },
          },
        },
      },
    );
    await assert.rejects(extractor('# Projekt'), expected);
    assert.equal(calls, 1);
  }

  await t.test('refusal stop reason', async () => {
    await expectFailure(
      makeResponse({ stop_reason: 'refusal', stop_details: { type: 'refusal' } }),
      /abgelehnt/,
    );
  });

  await t.test('refusal content block', async () => {
    await expectFailure(
      makeResponse({ content: [{ type: 'refusal', refusal: 'no' }] }),
      /abgelehnt/,
    );
  });

  await t.test('non-end-turn stop reason', async () => {
    await expectFailure(
      makeResponse({ stop_reason: 'max_tokens' }),
      /nicht regulär abgeschlossen/,
    );
  });

  await t.test('no text block', async () => {
    await expectFailure(
      makeResponse({ content: [{ type: 'thinking', thinking: 'intern' }] }),
      /keinen Metadaten-Text/,
    );
  });

  await t.test('invalid JSON', async () => {
    await expectFailure(
      makeResponse({ content: [{ type: 'text', text: '```json' }] }),
      /kein gültiges Metadaten-JSON/,
    );
  });
});

test('metadata normalization rejects extra, missing, empty, oversized, and malformed fields', async (t) => {
  const invalidCases = [
    ['extra key', { ...VALID_METADATA, secret: 'unexpected' }, /unerwartete oder fehlende/],
    ['missing key', {
      titel: VALID_METADATA.titel,
      summary: VALID_METADATA.summary,
      tags: VALID_METADATA.tags,
    }, /unerwartete oder fehlende/],
    ['not object', [], /JSON-Objekt/],
    ['empty title', { ...VALID_METADATA, titel: ' ' }, /titel ist leer oder zu lang/],
    ['long summary', { ...VALID_METADATA, summary: 'x'.repeat(1_001) }, /summary ist leer oder zu lang/],
    ['empty tags', { ...VALID_METADATA, tags: [] }, /tags muss eine begrenzte/],
    ['too many tags', { ...VALID_METADATA, tags: Array(13).fill('tag') }, /tags muss eine begrenzte/],
    ['non-string tag', { ...VALID_METADATA, tags: ['ok', 42] }, /tags muss Text/],
    ['long category', { ...VALID_METADATA, kategorie: 'x'.repeat(101) }, /kategorie ist leer oder zu lang/],
  ];

  for (const [name, value, expected] of invalidCases) {
    await t.test(name, () => {
      assert.throws(() => normalizeMetadata(value), expected);
    });
  }
});

test('metadata extractor validates its configuration and input before a provider call', async () => {
  assert.throws(
    () => createMetadataExtractor({ apiKey: ' ' }),
    /API-Key fehlt/,
  );

  let called = false;
  const extractor = createMetadataExtractor(
    { apiKey: 'anthropic-secret' },
    {
      client: {
        messages: {
          async create() {
            called = true;
            return makeResponse();
          },
        },
      },
    },
  );

  await assert.rejects(extractor(' '), /darf nicht leer sein/);
  assert.equal(called, false);
});
