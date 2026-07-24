export const VOYAGE_EMBEDDING_MODEL = 'voyage-4';
export const VOYAGE_EMBEDDING_DIMENSIONS = 1_024;
export const VOYAGE_EMBEDDINGS_URL = 'https://api.voyageai.com/v1/embeddings';

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 250;
const INPUT_TYPES = new Set(['document', 'query']);

function defaultSleep(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function shouldRetry(status) {
  return status === 429 || (status >= 500 && status <= 599);
}

function validateEmbeddingResponse(payload) {
  if (payload?.model !== VOYAGE_EMBEDDING_MODEL) {
    throw new Error('Voyage-Antwort verwendet ein unerwartetes Modell.');
  }

  if (
    !Array.isArray(payload.data)
    || payload.data.length !== 1
    || payload.data[0]?.index !== 0
  ) {
    throw new Error('Voyage-Antwort enthält keinen eindeutigen Embedding-Datensatz.');
  }

  const embedding = payload.data[0].embedding;
  if (
    !Array.isArray(embedding)
    || embedding.length !== VOYAGE_EMBEDDING_DIMENSIONS
    || embedding.some((value) => typeof value !== 'number' || !Number.isFinite(value))
  ) {
    throw new Error('Voyage-Antwort enthält kein gültiges 1024-dimensionales Embedding.');
  }

  return embedding;
}

export function createEmbedder({ apiKey }, dependencies = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    throw new Error('Voyage API-Key fehlt.');
  }

  const fetchImpl = dependencies.fetch ?? globalThis.fetch;
  const sleep = dependencies.sleep ?? defaultSleep;
  const timeoutMs = dependencies.timeoutMs ?? REQUEST_TIMEOUT_MS;

  if (typeof fetchImpl !== 'function') {
    throw new Error('Fetch-Implementierung fehlt.');
  }
  if (typeof sleep !== 'function') {
    throw new Error('Sleep-Implementierung fehlt.');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new Error('Voyage-Timeout muss eine positive Ganzzahl sein.');
  }

  return async function embed(text, { inputType } = {}) {
    if (typeof text !== 'string' || !text.trim()) {
      throw new Error('Embedding-Text darf nicht leer sein.');
    }
    if (!INPUT_TYPES.has(inputType)) {
      throw new Error('inputType muss document oder query sein.');
    }

    const body = JSON.stringify({
      input: text,
      model: VOYAGE_EMBEDDING_MODEL,
      input_type: inputType,
      truncation: false,
      output_dimension: VOYAGE_EMBEDDING_DIMENSIONS,
      output_dtype: 'float',
    });

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        let response;
        try {
          response = await fetchImpl(VOYAGE_EMBEDDINGS_URL, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json',
            },
            body,
            signal: controller.signal,
          });
        } catch {
          throw new Error('Voyage-Anfrage konnte nicht ausgeführt werden.');
        }

        if (!response?.ok) {
          const status = Number.isInteger(response?.status) ? response.status : 0;
          if (attempt < MAX_ATTEMPTS && shouldRetry(status)) {
            await sleep(RETRY_DELAY_MS * attempt);
            continue;
          }
          throw new Error(`Voyage-Anfrage fehlgeschlagen (HTTP ${status || 'unbekannt'}).`);
        }

        let payload;
        try {
          payload = await response.json();
        } catch {
          throw new Error('Voyage-Antwort enthält kein gültiges JSON.');
        }

        return validateEmbeddingResponse(payload);
      } finally {
        clearTimeout(timeout);
      }
    }

    throw new Error('Voyage-Anfrage fehlgeschlagen.');
  };
}
