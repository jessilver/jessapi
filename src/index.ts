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
    // Carrega os comandos antes de iniciar o socket para evitar race conditions
    await handler.loadCommands();

    // 1. Configuração de autenticação persistente no volume do Docker
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    
    // 2. Busca a versão mais estável do WhatsApp Web
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        auth: state,
        // Sugestão: manter o link de preview ativo para links enviados pelo bot
        browser: ['JessAPI', 'Chrome', '1.0.0'] 
    });

    // 3. Salva credenciais (essencial para evitar deslogar no container)
    sock.ev.on('creds.update', saveCreds);

    // 4. Monitoramento da Conexão e Ativação de Recursos de Perfil
    sock.ev.on('connection.update', async (update) => {
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
            try {
                // Teste de Sincronização Real: Altera o Recado (Bio)
                const novoStatus = `JessAPI Ativa 🚀 | ${new Date().toLocaleTimeString()}`;
                await sock.updateProfileStatus(novoStatus);
                
                // Se este log aparecer, a ponte entre o Docker e o seu WhatsApp está 100% aberta
                console.log(`✨ Sincronização Real: Status alterado para "${novoStatus}"`);
            } catch (e) {
                console.log("❌ Erro: O WhatsApp impediu a alteração do perfil.");
            }
        }
    });

    // 5. Escutando mensagens recebidas
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        // Filtra apenas para notificações de mensagens novas
        if (type !== 'notify') return; 

        const msg = messages[0];
        
        // Log de rastreio para o terminal do VS Code/Docker
        console.log(`📥 Nova mensagem de: ${msg.key.remoteJid} | fromMe: ${msg.key.fromMe}`);

        if (!msg.message) {
            console.log("⏭️ Mensagem ignorada (corpo vazio)");
            return;
        }

        // Encaminha para o CommandHandler (onde estão seus 7 gatilhos)
        try {
            await handler.handle(sock, msg);
        } catch (err) {
            console.error("❌ Erro ao processar comando no Handler:", err);
        }
    });
}

// Inicialização com tratamento de erro global
startBot().catch(err => console.error("🚨 Erro crítico na inicialização:", err));