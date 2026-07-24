import {
  downloadMediaMessage,
  extractMessageContent,
} from '@whiskeysockets/baileys';
import { TextDecoder } from 'node:util';

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export const MAX_MARKDOWN_BYTES = 1024 * 1024;

function getDeclaredFileSize(document) {
  const value = document?.fileLength;

  if (typeof value === 'number') {
    return Number.isSafeInteger(value) && value >= 0 ? BigInt(value) : null;
  }

  if (typeof value === 'bigint') {
    return value >= 0n ? value : null;
  }

  let text;
  if (typeof value === 'string') {
    text = value;
  } else if (value && typeof value.toString === 'function') {
    try {
      text = value.toString();
    } catch {
      return null;
    }
  }

  if (typeof text !== 'string' || !/^\d{1,20}$/.test(text)) {
    return null;
  }

  return BigInt(text);
}

function decodeMarkdown(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    throw new Error('Der Markdown-Download hat keinen Buffer geliefert.');
  }

  if (buffer.length > MAX_MARKDOWN_BYTES) {
    throw new Error(`Markdown-Anhang überschreitet das Limit von ${MAX_MARKDOWN_BYTES} Bytes.`);
  }

  let markdown;
  try {
    markdown = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    throw new Error('Markdown-Anhang enthält kein gültiges UTF-8.');
  }

  if (markdown.includes('\0')) {
    throw new Error('Markdown-Anhang enthält unzulässige NUL-Bytes.');
  }

  return markdown;
}

export function sanitizeLogText(value, maxLength = 96) {
  const normalized = typeof value === 'string'
    ? value
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    : '';

  if (!normalized) return '(unbekannt)';
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function formatSafeErrorMessage(error) {
  const message = typeof error?.message === 'string'
    ? error.message
    : 'Unbekannter Fehler';
  return sanitizeLogText(message, 160);
}

export function inspectMarkdownDocument(message) {
  const content = extractMessageContent(message?.message);
  const document = content?.documentMessage;
  const fileName = document?.fileName;

  return {
    document,
    fileName,
    isMarkdown: isNonEmptyString(fileName) && fileName.toLowerCase().endsWith('.md'),
  };
}

export function createMessageIngestor({
  targetGroupJid,
  projectRepository,
  downloadMedia = downloadMediaMessage,
}) {
  if (!isNonEmptyString(targetGroupJid)) {
    throw new Error('targetGroupJid darf nicht leer sein.');
  }

  if (typeof projectRepository?.upsertProjekt !== 'function') {
    throw new Error('projectRepository.upsertProjekt muss eine Funktion sein.');
  }

  return async function ingestMessage(sock, message) {
    if (message?.key?.fromMe) {
      return { status: 'ignored', reason: 'from-me' };
    }

    const remoteJid = message?.key?.remoteJid;
    if (!isNonEmptyString(remoteJid) || remoteJid !== targetGroupJid) {
      return { status: 'ignored', reason: 'target-group' };
    }

    const { document, fileName, isMarkdown } = inspectMarkdownDocument(message);
    if (!isMarkdown) {
      return { status: 'ignored', reason: 'not-markdown' };
    }

    const waMessageId = message?.key?.id;
    if (!isNonEmptyString(waMessageId)) {
      throw new Error(
        `Markdown-Nachricht „${sanitizeLogText(fileName, 160)}“ `
        + 'hat keine stabile WhatsApp-Nachrichten-ID.',
      );
    }

    const declaredSize = getDeclaredFileSize(document);
    if (declaredSize !== null && declaredSize > BigInt(MAX_MARKDOWN_BYTES)) {
      throw new Error(`Markdown-Anhang überschreitet das Limit von ${MAX_MARKDOWN_BYTES} Bytes.`);
    }

    const buffer = await downloadMedia(message, 'buffer', {});
    const rawMd = decodeMarkdown(buffer);
    const participant = message.key.participant;
    const authorJid = isNonEmptyString(participant) ? participant : remoteJid;
    const row = {
      wa_message_id: waMessageId,
      author_name: message.pushName,
      author_jid: authorJid,
      raw_md: rawMd,
    };

    await projectRepository.upsertProjekt(row);
    await sock.sendMessage(
      remoteJid,
      { text: `✅ „${sanitizeLogText(fileName, 160)}“ erfasst.` },
    );

    return { status: 'ingested', fileName, row };
  };
}

export function createMessagesUpsertHandler({
  sock,
  targetGroupJid,
  ingestMessage,
  log = console.log,
  logError = console.error,
}) {
  return async function handleMessagesUpsert({ messages = [] }) {
    for (const message of messages) {
      if (message?.key?.fromMe) continue;
      if (message?.key?.remoteJid !== targetGroupJid) continue;

      try {
        const { fileName, isMarkdown } = inspectMarkdownDocument(message);
        log({
          from: sanitizeLogText(message.pushName),
          isMd: isMarkdown,
          file: fileName === undefined ? undefined : sanitizeLogText(fileName),
        });

        await ingestMessage(sock, message);
      } catch (error) {
        const messageId = sanitizeLogText(message?.key?.id, 48);
        logError(`Ingest fehlgeschlagen (${messageId}): ${formatSafeErrorMessage(error)}`);
      }
    }
  };
}
