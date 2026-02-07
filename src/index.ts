import makeWASocket, {
    DisconnectReason,
    useMultiFileAuthState,
    fetchLatestBaileysVersion
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import qrcode from 'qrcode-terminal';
import { CommandHandler } from './CommandHandler.js';

const handler = new CommandHandler();

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        auth: state,
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log('--- ESCANEIE O QR CODE ABAIXO ---');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('🔄 Conexão fechada. Tentando reconectar:', shouldReconnect);
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('✅ Bot conectado com sucesso no WhatsApp!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return; 

        const msg = messages[0];
        
        // Log para confirmar que o Docker está recebendo a mensagem
        console.log(`📥 Nova mensagem de: ${msg.key.remoteJid} | fromMe: ${msg.key.fromMe}`);

        if (!msg.message) {
            console.log("⏭️ Mensagem ignorada (vazia)");
            return;
        }

        // Removida a trava fromMe para permitir auto-comandos no teste
        try {
            await handler.handle(sock, msg);
        } catch (err) {
            console.error("❌ Erro no Handler:", err);
        }
    });
}

startBot().catch(err => console.error("🚨 Erro crítico:", err));