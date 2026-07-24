import { extractMessageContent } from '@whiskeysockets/baileys';
import { sanitizeLogText } from './ingest.js';

export const COMMAND_PREFIX = '/';
export const MAX_COMMAND_NAME_CHARS = 32;
export const MAX_QUERY_CHARS = 500;
export const SEARCH_RESULT_LIMIT = 5;

const COMMAND_NAME_PATTERN = new RegExp(`^[a-z0-9_-]{1,${MAX_COMMAND_NAME_CHARS}}$`);
const MAX_TITLE_CHARS = 160;
const MAX_STATUS_CHARS = 32;

const USAGE_TEXT = 'Nutzung: /suche <suchbegriff>';
const QUERY_TOO_LONG_TEXT = `Suchbegriff ist zu lang (höchstens ${MAX_QUERY_CHARS} Zeichen).`;
const NO_RESULTS_TEXT = 'Nichts gefunden.';
const SEARCH_FAILED_TEXT = 'Die Suche ist gerade nicht möglich.';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function extractCommand(message) {
  const content = extractMessageContent(message?.message);
  const text = isNonEmptyString(content?.conversation)
    ? content.conversation
    : content?.extendedTextMessage?.text;

  if (!isNonEmptyString(text)) return null;

  const trimmed = text.trim();
  if (!trimmed.startsWith(COMMAND_PREFIX)) return null;

  const separatorIndex = trimmed.search(/\s/);
  const rawName = separatorIndex === -1 ? trimmed : trimmed.slice(0, separatorIndex);
  const name = rawName.slice(COMMAND_PREFIX.length).toLowerCase();

  if (!COMMAND_NAME_PATTERN.test(name)) return null;

  return {
    name,
    argument: separatorIndex === -1 ? '' : trimmed.slice(separatorIndex + 1).trim(),
  };
}

function readRowId(value) {
  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }

  if (typeof value === 'string' && /^\d{1,15}$/.test(value.trim())) {
    const parsed = Number(value.trim());
    return parsed > 0 ? parsed : null;
  }

  return null;
}

function formatSearchResult(row) {
  const id = readRowId(row?.id);
  if (id === null || !isNonEmptyString(row?.titel)) return null;

  const status = sanitizeLogText(row?.status, MAX_STATUS_CHARS);
  return `#${id} [${status}] ${sanitizeLogText(row.titel, MAX_TITLE_CHARS)}`;
}

export function formatSearchResults(rows) {
  const lines = (Array.isArray(rows) ? rows : [])
    .slice(0, SEARCH_RESULT_LIMIT)
    .map(formatSearchResult)
    .filter((line) => line !== null);

  return lines.length > 0 ? lines.join('\n') : NO_RESULTS_TEXT;
}

export function createCommandHandler({ targetGroupJid, projectRepository, embed }) {
  if (!isNonEmptyString(targetGroupJid)) {
    throw new Error('targetGroupJid darf nicht leer sein.');
  }

  if (typeof projectRepository?.searchProjekte !== 'function') {
    throw new Error('projectRepository.searchProjekte muss eine Funktion sein.');
  }

  if (typeof embed !== 'function') {
    throw new Error('embed muss eine Funktion sein.');
  }

  return async function handleCommand(sock, message) {
    if (message?.key?.fromMe) {
      return { status: 'ignored', reason: 'from-me' };
    }

    const remoteJid = message?.key?.remoteJid;
    if (!isNonEmptyString(remoteJid) || remoteJid !== targetGroupJid) {
      return { status: 'ignored', reason: 'target-group' };
    }

    const command = extractCommand(message);
    if (!command) {
      return { status: 'ignored', reason: 'not-a-command' };
    }

    if (command.name !== 'suche') {
      return { status: 'unknown-command', command: command.name };
    }

    if (!command.argument) {
      await sock.sendMessage(remoteJid, { text: USAGE_TEXT });
      return { status: 'rejected', command: command.name, reason: 'empty-query' };
    }

    if (command.argument.length > MAX_QUERY_CHARS) {
      await sock.sendMessage(remoteJid, { text: QUERY_TOO_LONG_TEXT });
      return { status: 'rejected', command: command.name, reason: 'query-too-long' };
    }

    let results;
    try {
      const embedding = await embed(command.argument, { inputType: 'query' });
      results = await projectRepository.searchProjekte({
        embedding,
        queryText: command.argument,
        treffer: SEARCH_RESULT_LIMIT,
      });
    } catch (error) {
      await sock.sendMessage(remoteJid, { text: SEARCH_FAILED_TEXT });
      throw error;
    }

    await sock.sendMessage(remoteJid, { text: formatSearchResults(results) });
    return { status: 'searched', command: command.name, results };
  };
}
