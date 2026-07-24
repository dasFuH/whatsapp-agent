import 'dotenv/config';

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import { createCommandHandler } from './commands.js';
import { loadConfig } from './config.js';
import { createProjectRepository } from './db.js';
import { createEmbedder } from './embed.js';
import {
  createMessageIngestor,
  createMessagesUpsertHandler,
  formatSafeErrorMessage,
} from './ingest.js';
import { createMetadataExtractor } from './llm.js';

const logger = pino({ level: 'warn' });

async function start({
  config,
  projectRepository,
  extractMetadata,
  embed,
}) {
  const { state, saveCreds } = await useMultiFileAuthState('./auth');
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({ auth: state, version, logger });
  const ingestMessage = createMessageIngestor({
    targetGroupJid: config.targetGroupJid,
    projectRepository,
    extractMetadata,
    embed,
  });
  const handleCommand = createCommandHandler({
    targetGroupJid: config.targetGroupJid,
    projectRepository,
    embed,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, qr, lastDisconnect } = update;
    if (qr) qrcode.generate(qr, { small: true });
    if (connection === 'open') console.log('✅ Verbunden mit WhatsApp.');
    if (connection === 'close') {
      const loggedOut = lastDisconnect?.error?.output?.statusCode === DisconnectReason.loggedOut;
      console.log('Verbindung getrennt.', loggedOut ? '(ausgeloggt, kein Reconnect)' : '(reconnect...)');
      if (!loggedOut) {
        start({
          config,
          projectRepository,
          extractMetadata,
          embed,
        }).catch((error) => {
          console.error(`Reconnect fehlgeschlagen: ${formatSafeErrorMessage(error)}`);
        });
      }
    }
  });

  sock.ev.on('messages.upsert', createMessagesUpsertHandler({
    sock,
    targetGroupJid: config.targetGroupJid,
    ingestMessage,
    handleCommand,
  }));
}

async function main() {
  const config = loadConfig();
  const projectRepository = createProjectRepository(config);
  const extractMetadata = createMetadataExtractor({
    apiKey: config.anthropicApiKey,
  });
  const embed = createEmbedder({
    apiKey: config.voyageApiKey,
  });
  await start({
    config,
    projectRepository,
    extractMetadata,
    embed,
  });
}

main().catch((error) => {
  console.error(`Bot-Start fehlgeschlagen: ${formatSafeErrorMessage(error)}`);
  process.exitCode = 1;
});
