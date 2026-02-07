import { Command } from './Command.js';
import { WASocket, WAMessage } from '@whiskeysockets/baileys';

export class PingCommand implements Command {
    name = 'ping';
    description = 'Verifica a latência do bot';
    aliases = ['p'];

    async execute(sock: WASocket, msg: WAMessage, args: string[]): Promise<void> {
        const jid = msg.key.remoteJid;

        if (jid) {
            // Agora o 'quoted: msg' não dará erro, pois ambos são WAMessage
            await sock.sendMessage(jid, { text: '🏓 Pong!' }, { quoted: msg });
        }
    }
}