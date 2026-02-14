import { Command } from './Command.js';
import { WASocket, WAMessage } from '@whiskeysockets/baileys';

export class HelpCommand implements Command {
    name = 'help';
    description = 'Abre o menu interativo de comandos';
    aliases = ['ajuda', 'h'];

    async execute(sock: WASocket, msg: WAMessage, args: string[]): Promise<void> {
        const jid = msg.key.remoteJid;
        if (!jid) return;

        const menu = `📌 *JESSAPI - MENU DE COMANDOS*\n\n` +
                    `Olá! Digite um dos comandos abaixo para interagir:\n\n` +
                    `1️⃣ *!ping* - Verifica se o bot está online\n` +
                    `2️⃣ *!look* - Dados da conversa atual\n` +
                    `3️⃣ *!look me* - Seus dados de perfil\n` +
                    `4️⃣ *!look @(marcar)* - Dados de outro usuário\n\n` +
                    `_Dica: Você pode responder a uma mensagem com !look para ver os dados de quem enviou._`;

        await sock.sendMessage(jid, { 
            text: menu,
            mentions: [msg.key.participant || jid] 
        }, { quoted: msg });
    }
}