import makeWASocket, { fetchLatestBaileysVersion, useMultiFileAuthState } from '@whiskeysockets/baileys';
import pino from 'pino';

async function main() {
    const JID = '5563991035753@s.whatsapp.net'; // target provided

    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        auth: state,
        printQRInTerminal: true,
    });

    sock.ev.on('creds.update', saveCreds);

    await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('connect timeout')), 30000);
        sock.ev.on('connection.update', (u) => {
            if (u.connection === 'open') {
                clearTimeout(timeout);
                resolve();
            }
            if (u.connection === 'close') {
                // ignore
            }
        });
    });

    const listPayload = {
        title: '📌 TESTE - MENU',
        text: 'Selecione uma opção de teste',
        buttonText: 'Abrir',
        footer: 'JessAPI Test',
        sections: [
            {
                title: 'Testes',
                rows: [
                    { id: 'TEST_CMD_1', title: 'Teste 1', description: 'Descrição 1' },
                    { id: 'TEST_CMD_2', title: 'Teste 2', description: 'Descrição 2' }
                ]
            }
        ]
    } as any;

    try {
        console.log('Sending list to', JID);
        const res = await sock.sendMessage(JID, listPayload as any);
        console.log('sendMessage result:', JSON.stringify(res, null, 2));
    } catch (err) {
        console.error('sendList error:', err);
    }

    const buttonsPayload = {
        text: 'Teste de botões',
        footer: 'JessAPI Test',
        buttons: [
            { buttonId: 'BTN_1', buttonText: { displayText: 'Botão 1' }, type: 1 },
            { buttonId: 'BTN_2', buttonText: { displayText: 'Botão 2' }, type: 1 }
        ],
        headerType: 1
    } as any;

    try {
        console.log('Sending buttons to', JID);
        const res2 = await sock.sendMessage(JID, buttonsPayload as any);
        console.log('sendMessage buttons result:', JSON.stringify(res2, null, 2));
    } catch (err) {
        console.error('sendButtons error:', err);
    }

    await sock.logout();
    process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
