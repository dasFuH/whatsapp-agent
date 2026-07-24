import Anthropic from '@anthropic-ai/sdk';

export const METADATA_MODEL = 'claude-fable-5';
export const MAX_METADATA_INPUT_CHARS = 12_000;
// claude-fable-5 denkt immer; Thinking-Tokens zählen gegen max_tokens. Genug
// Kopffreiheit lassen, damit die JSON-Metadaten nicht abgeschnitten werden.
export const MAX_METADATA_OUTPUT_TOKENS = 8_192;

const METADATA_KEYS = Object.freeze([
  'titel',
  'summary',
  'tags',
  'kategorie',
]);

const LIMITS = Object.freeze({
  titel: 200,
  summary: 1_000,
  tag: 64,
  tags: 12,
  kategorie: 100,
});

const SYSTEM_PROMPT = [
  'Du extrahierst Metadaten aus einer Markdown-Projektbeschreibung.',
  'Gib ausschließlich die vom angeforderten JSON-Schema beschriebenen Metadaten zurück.',
  'Die Zusammenfassung besteht aus höchstens einem Satz.',
].join(' ');

const METADATA_SCHEMA = Object.freeze({
  type: 'object',
  additionalProperties: false,
  required: METADATA_KEYS,
  properties: {
    titel: {
      type: 'string',
      minLength: 1,
      maxLength: LIMITS.titel,
    },
    summary: {
      type: 'string',
      minLength: 1,
      maxLength: LIMITS.summary,
    },
    tags: {
      type: 'array',
      minItems: 1,
      maxItems: LIMITS.tags,
      items: {
        type: 'string',
        minLength: 1,
        maxLength: LIMITS.tag,
      },
    },
    kategorie: {
      type: 'string',
      minLength: 1,
      maxLength: LIMITS.kategorie,
    },
  },
});

function normalizeBoundedString(value, field, maxLength) {
  if (typeof value !== 'string') {
    throw new Error(`Metadatenfeld ${field} muss Text enthalten.`);
  }

  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(`Metadatenfeld ${field} ist leer oder zu lang.`);
  }

  return normalized;
}

export function normalizeMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Metadaten müssen ein JSON-Objekt sein.');
  }

  const keys = Object.keys(value);
  if (
    keys.length !== METADATA_KEYS.length
    || keys.some((key) => !METADATA_KEYS.includes(key))
    || METADATA_KEYS.some((key) => !Object.hasOwn(value, key))
  ) {
    throw new Error('Metadaten enthalten unerwartete oder fehlende Felder.');
  }

  if (!Array.isArray(value.tags) || value.tags.length < 1 || value.tags.length > LIMITS.tags) {
    throw new Error('Metadatenfeld tags muss eine begrenzte, nicht leere Liste sein.');
  }

  const tags = value.tags.map((tag) => normalizeBoundedString(tag, 'tags', LIMITS.tag));

  return {
    titel: normalizeBoundedString(value.titel, 'titel', LIMITS.titel),
    summary: normalizeBoundedString(value.summary, 'summary', LIMITS.summary),
    tags,
    kategorie: normalizeBoundedString(value.kategorie, 'kategorie', LIMITS.kategorie),
  };
}

export function createMetadataExtractor({ apiKey }, dependencies = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    throw new Error('Anthropic API-Key fehlt.');
  }

  const client = dependencies.client
    ?? new (dependencies.Anthropic ?? Anthropic)({ apiKey });

  if (typeof client?.messages?.create !== 'function') {
    throw new Error('Anthropic-Client stellt messages.create nicht bereit.');
  }

  return async function extractMetadata(markdown) {
    if (typeof markdown !== 'string' || !markdown.trim()) {
      throw new Error('Markdown für die Metadatenextraktion darf nicht leer sein.');
    }

    const response = await client.messages.create({
      model: METADATA_MODEL,
      max_tokens: MAX_METADATA_OUTPUT_TOKENS,
      system: SYSTEM_PROMPT,
      messages: [{
        role: 'user',
        content: markdown.slice(0, MAX_METADATA_INPUT_CHARS),
      }],
      output_config: {
        effort: 'low',
        format: {
          type: 'json_schema',
          schema: METADATA_SCHEMA,
        },
      },
    });

    if (
      response?.stop_reason === 'refusal'
      || response?.stop_details?.type === 'refusal'
      || response?.content?.some((block) => block?.type === 'refusal')
    ) {
      throw new Error('Anthropic hat die Metadatenextraktion abgelehnt.');
    }

    if (response?.stop_reason !== 'end_turn') {
      throw new Error('Anthropic-Antwort wurde nicht regulär abgeschlossen.');
    }

    const text = response?.content?.find(
      (block) => block?.type === 'text'
        && typeof block.text === 'string'
        && block.text.trim(),
    )?.text;

    if (typeof text !== 'string' || !text.trim()) {
      throw new Error('Anthropic-Antwort enthält keinen Metadaten-Text.');
    }

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('Anthropic-Antwort enthält kein gültiges Metadaten-JSON.');
    }

    return normalizeMetadata(parsed);
  };
}
