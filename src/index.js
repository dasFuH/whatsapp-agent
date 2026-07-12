import makeWASocket, { useMultiFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';

async function start() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth');
  const sock = makeWASocket({ auth: state });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, qr, lastDisconnect } = update;
    if (qr) qrcode.generate(qr, { small: true });
    if (connection === 'open') console.log('✅ Verbunden mit WhatsApp.');
    if (connection === 'close') {
      const loggedOut = lastDisconnect?.error?.output?.statusCode === DisconnectReason.loggedOut;
      console.log('Verbindung getrennt.', loggedOut ? '(ausgeloggt, kein Reconnect)' : '(reconnect...)');
      if (!loggedOut) start();
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const m of messages) {
      if (m.key.fromMe) continue;
      const doc = m.message?.documentMessage;
      const isMd = doc?.fileName?.toLowerCase().endsWith('.md') ?? false;
      console.log({ from: m.pushName, jid: m.key.remoteJid, isMd, file: doc?.fileName });
    }
  });
}

start();
