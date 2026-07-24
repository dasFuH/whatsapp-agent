import 'dotenv/config';

import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import pino from 'pino';
import { loadConfig } from './config.js';
import { createProjectRepository } from './db.js';
import {
  createMessageIngestor,
  createMessagesUpsertHandler,
  formatSafeErrorMessage,
} from './ingest.js';

const logger = pino({ level: 'warn' });

async function start({ config, projectRepository }) {
  const { state, saveCreds } = await useMultiFileAuthState('./auth');
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({ auth: state, version, logger });
  const ingestMessage = createMessageIngestor({
    targetGroupJid: config.targetGroupJid,
    projectRepository,
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
        start({ config, projectRepository }).catch((error) => {
          console.error(`Reconnect fehlgeschlagen: ${formatSafeErrorMessage(error)}`);
        });
      }
    }
  });

  sock.ev.on('messages.upsert', createMessagesUpsertHandler({
    sock,
    targetGroupJid: config.targetGroupJid,
    ingestMessage,
  }));
}

async function main() {
  const config = loadConfig();
  const projectRepository = createProjectRepository(config);
  await start({ config, projectRepository });
}

main().catch((error) => {
  console.error(`Bot-Start fehlgeschlagen: ${formatSafeErrorMessage(error)}`);
  process.exitCode = 1;
});
