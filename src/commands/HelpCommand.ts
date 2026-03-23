import { Command } from './Command.js';
import { WASocket, WAMessage } from '@whiskeysockets/baileys';
import { sendListMessage, sendButtonsMessage } from '../utils/messages.js';

export class HelpCommand implements Command {
    name = 'help';
    description = 'Abre o menu interativo de comandos';
    aliases = ['ajuda', 'h'];

    async execute(sock: WASocket, msg: WAMessage, args: string[]): Promise<void> {
        const jid = msg.key.remoteJid;
        if (!jid) return;
        const fallback = `📌 JESSAPI - MENU DE COMANDOS\n\n` +
                         `Use o menu interativo para executar comandos rapidamente.`;

        const listMessage = {
            title: '📌 JESSAPI - MENU DE COMANDOS',
            description: 'Escolha uma ação abaixo para interagir com o bot',
            buttonText: 'Abrir Menu',
            footerText: 'JessAPI • Interativo',
            sections: [
                {
                    title: 'Comandos',
                    rows: [
                        { title: '🏓 Ping', rowId: 'CMD:!ping', description: 'Verifica se o bot está online' },
                        { title: '🔎 Look (Chat)', rowId: 'CMD:!look', description: 'Dados da conversa atual' },
                        { title: '👤 Look (Me)', rowId: 'CMD:!look me', description: 'Seus dados de perfil' },
                        { title: '📌 Look (Marcar)', rowId: 'ACTION:look_mention', description: 'Instruções para marcar alguém e ver dados' }
                    ]
                }
            ]
        };

            // Envia um texto formatado simples (fallback elegante) ao invés de lista interativa
            const menu = `📌 *JESSAPI — MENU DE COMANDOS*\n\n` +
                         `Olá! Use um dos comandos abaixo para interagir com o bot:\n\n` +
                         `*🏓 !ping* — Verifica se o bot está online\n` +
                         `*🔎 !look* — Dados da conversa atual\n` +
                         `*👤 !look me* — Seus dados de perfil\n` +
                         `*📌 !look @usuario* — Dados de outro usuário (mencione alguém)\n\n` +
                         `_Dica: Responda a uma mensagem com !look para ver os dados do autor._`;

            await sock.sendMessage(jid, {
                text: menu,
                mentions: [msg.key.participant || jid]
            }, { quoted: msg });
    }
}