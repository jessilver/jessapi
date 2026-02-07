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
    // 1. Configuração de autenticação (salva a sessão na pasta 'auth_info')
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    
    // 2. Busca a versão mais recente do WhatsApp Web para evitar incompatibilidades
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }), // Silencia logs técnicos pesados
        auth: state,
        // printQRInTerminal: true <- Removido para evitar o aviso de deprecation
    });

    // 3. Salva as credenciais sempre que houver uma atualização (essencial para não deslogar)
    sock.ev.on('creds.update', saveCreds);

    // 4. Monitoramento da Conexão e exibição do QR Code
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        // Se a lib gerar um QR Code, exibimos no terminal usando qrcode-terminal
        if (qr) {
            console.log('--- ESCANEIE O QR CODE ABAIXO ---');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect?.error as Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Conexão fechada. Tentando reconectar:', shouldReconnect);
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            console.log('Bot conectado com sucesso no WhatsApp!');
        }
    });

    // 5. Escutando mensagens recebidas — delega para CommandHandler
    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        // Passa a bola para o handler decidir o que fazer
        await handler.handle(sock, msg);
    });
}

// Inicializa o bot
startBot().catch(err => console.error("Erro inesperado:", err));
