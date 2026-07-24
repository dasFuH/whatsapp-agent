import assert from 'node:assert/strict';
import test from 'node:test';
import {
  VOYAGE_EMBEDDING_DIMENSIONS,
  VOYAGE_EMBEDDING_MODEL,
  VOYAGE_EMBEDDINGS_URL,
  createEmbedder,
} from '../src/embed.js';

const API_KEY = 'voyage-secret';

function validEmbedding() {
  return Array.from(
    { length: VOYAGE_EMBEDDING_DIMENSIONS },
    (_, index) => index / VOYAGE_EMBEDDING_DIMENSIONS,
  );
}

function successResponse(overrides = {}) {
  const embedding = validEmbedding();
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        model: VOYAGE_EMBEDDING_MODEL,
        data: [{ index: 0, embedding }],
        ...overrides,
      };
    },
  };
}

test('embedder sends the exact Voyage request for document and query inputs', async (t) => {
  for (const inputType of ['document', 'query']) {
    await t.test(inputType, async () => {
      const calls = [];
      const expectedEmbedding = validEmbedding();
      const embed = createEmbedder(
        { apiKey: API_KEY },
        {
          async fetch(url, options) {
            calls.push({ url, options });
            return {
              ok: true,
              status: 200,
              async json() {
                return {
                  model: 'voyage-4',
                  data: [{ index: 0, embedding: expectedEmbedding }],
                };
              },
            };
          },
          async sleep() {
            throw new Error('not reached');
          },
        },
      );

      const result = await embed('Titel\nZusammenfassung', { inputType });

      assert.strictEqual(result, expectedEmbedding);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].url, VOYAGE_EMBEDDINGS_URL);
      assert.equal(calls[0].url, 'https://api.voyageai.com/v1/embeddings');
      assert.equal(calls[0].options.method, 'POST');
      assert.deepEqual(calls[0].options.headers, {
        Authorization: `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      });
      assert.equal(calls[0].options.signal instanceof AbortSignal, true);
      assert.deepEqual(JSON.parse(calls[0].options.body), {
        input: 'Titel\nZusammenfassung',
        model: 'voyage-4',
        input_type: inputType,
        truncation: false,
        output_dimension: 1_024,
        output_dtype: 'float',
      });
    });
  }
});

test('embedder retries only 429 and 5xx responses with bounded attempts', async () => {
  const statuses = [429, 503, 200];
  const sleeps = [];
  let fetchCalls = 0;
  const embed = createEmbedder(
    { apiKey: API_KEY },
    {
      async fetch() {
        const status = statuses[fetchCalls];
        fetchCalls += 1;
        return status === 200
          ? successResponse()
          : { ok: false, status };
      },
      async sleep(milliseconds) {
        sleeps.push(milliseconds);
      },
    },
  );

  const result = await embed('Projekt', { inputType: 'document' });

  assert.equal(result.length, VOYAGE_EMBEDDING_DIMENSIONS);
  assert.equal(fetchCalls, 3);
  assert.deepEqual(sleeps, [250, 500]);
});

test('embedder stops after three retryable failures', async () => {
  let calls = 0;
  const sleeps = [];
  const embed = createEmbedder(
    { apiKey: API_KEY },
    {
      async fetch() {
        calls += 1;
        return { ok: false, status: 500 };
      },
      async sleep(milliseconds) {
        sleeps.push(milliseconds);
      },
    },
  );

  await assert.rejects(
    embed('Projekt', { inputType: 'query' }),
    /HTTP 500/,
  );
  assert.equal(calls, 3);
  assert.deepEqual(sleeps, [250, 500]);
});

test('embedder does not retry other 4xx, network, JSON, or payload errors', async (t) => {
  await t.test('other 4xx and body stays unread', async () => {
    let calls = 0;
    let bodyRead = false;
    const embed = createEmbedder(
      { apiKey: API_KEY },
      {
        async fetch() {
          calls += 1;
          return {
            ok: false,
            status: 400,
            async json() {
              bodyRead = true;
              return { secret: API_KEY };
            },
          };
        },
      },
    );

    await assert.rejects(
      embed('Projekt', { inputType: 'document' }),
      (error) => {
        assert.match(error.message, /HTTP 400/);
        assert.doesNotMatch(error.message, new RegExp(API_KEY));
        return true;
      },
    );
    assert.equal(calls, 1);
    assert.equal(bodyRead, false);
  });

  await t.test('network error is sanitized', async () => {
    let calls = 0;
    const embed = createEmbedder(
      { apiKey: API_KEY },
      {
        async fetch() {
          calls += 1;
          throw new Error(`request leaked ${API_KEY}`);
        },
      },
    );

    await assert.rejects(
      embed('Projekt', { inputType: 'document' }),
      (error) => {
        assert.equal(error.message, 'Voyage-Anfrage konnte nicht ausgeführt werden.');
        assert.doesNotMatch(error.message, new RegExp(API_KEY));
        return true;
      },
    );
    assert.equal(calls, 1);
  });

  await t.test('invalid JSON', async () => {
    let calls = 0;
    const embed = createEmbedder(
      { apiKey: API_KEY },
      {
        async fetch() {
          calls += 1;
          return {
            ok: true,
            status: 200,
            async json() {
              throw new Error(`body ${API_KEY}`);
            },
          };
        },
      },
    );

    await assert.rejects(
      embed('Projekt', { inputType: 'document' }),
      (error) => {
        assert.match(error.message, /kein gültiges JSON/);
        assert.doesNotMatch(error.message, new RegExp(API_KEY));
        return true;
      },
    );
    assert.equal(calls, 1);
  });
});

test('embedder rejects malformed model, data, index, dimension, and numeric values', async (t) => {
  const cases = [
    ['model mismatch', { model: 'voyage-other' }, /unerwartetes Modell/],
    ['no data', { data: [] }, /keinen eindeutigen/],
    ['multiple data items', {
      data: [
        { index: 0, embedding: validEmbedding() },
        { index: 1, embedding: validEmbedding() },
      ],
    }, /keinen eindeutigen/],
    ['wrong index', {
      data: [{ index: 1, embedding: validEmbedding() }],
    }, /keinen eindeutigen/],
    ['wrong dimension', {
      data: [{ index: 0, embedding: [0.1] }],
    }, /1024-dimensionales/],
    ['non-number', {
      data: [{ index: 0, embedding: Array(1_024).fill('0.1') }],
    }, /1024-dimensionales/],
    ['non-finite number', {
      data: [{ index: 0, embedding: Array(1_024).fill(Number.POSITIVE_INFINITY) }],
    }, /1024-dimensionales/],
  ];

  for (const [name, payload, expected] of cases) {
    await t.test(name, async () => {
      let calls = 0;
      const embed = createEmbedder(
        { apiKey: API_KEY },
        {
          async fetch() {
            calls += 1;
            return successResponse(payload);
          },
        },
      );

      await assert.rejects(
        embed('Projekt', { inputType: 'document' }),
        expected,
      );
      assert.equal(calls, 1);
    });
  }
});

test('embedder enforces a bounded response-body timeout without retrying', async () => {
  let calls = 0;
  const embed = createEmbedder(
    { apiKey: API_KEY },
    {
      timeoutMs: 5,
      async fetch(_url, { signal }) {
        calls += 1;
        return {
          ok: true,
          status: 200,
          json() {
            return new Promise((resolve, reject) => {
              signal.addEventListener(
                'abort',
                () => reject(new Error(`timeout leaked ${API_KEY}`)),
                { once: true },
              );
            });
          },
        };
      },
    },
  );

  await assert.rejects(
    embed('Projekt', { inputType: 'query' }),
    (error) => {
      assert.equal(error.message, 'Voyage-Antwort enthält kein gültiges JSON.');
      assert.doesNotMatch(error.message, new RegExp(API_KEY));
      return true;
    },
  );
  assert.equal(calls, 1);
});

test('embedder rejects invalid configuration and input before fetch', async () => {
  assert.throws(() => createEmbedder({ apiKey: '' }), /API-Key fehlt/);

  let called = false;
  const embed = createEmbedder(
    { apiKey: API_KEY },
    {
      async fetch() {
        called = true;
        return successResponse();
      },
    },
  );

  await assert.rejects(embed('', { inputType: 'document' }), /darf nicht leer sein/);
  await assert.rejects(embed('Projekt', { inputType: 'search' }), /document oder query/);
  await assert.rejects(embed('Projekt'), /document oder query/);
  assert.equal(called, false);
});
