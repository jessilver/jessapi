import { Command } from './Command.js';
import { WASocket, WAMessage } from '@whiskeysockets/baileys';
import { CommandHandler } from '../CommandHandler.js';

export class HelpCommand implements Command {
    name = 'help';
    description = 'Exibe a lista de todos os comandos disponíveis.';
    aliases = ['ajuda', 'menu'];

    async execute(sock: WASocket, msg: WAMessage, args: string[]): Promise<void> {
        const jid = msg.key.remoteJid!;
        
        // Aqui instanciamos o handler apenas para ler os comandos já carregados
        // Em uma arquitetura mais avançada, poderíamos usar um Singleton
        const handler = new CommandHandler(); 
        const commands = handler.getCommands();

        let menu = `🤖 *JessAPI - Menu de Comandos*\n\n`;
        
        commands.forEach(cmd => {
            menu += `*!${cmd.name}* - ${cmd.description}\n`;
            if (cmd.aliases.length > 0) {
                menu += `└ _Atalhos: ${cmd.aliases.join(', ')}_\n`;
            }
            menu += `\n`;
        });

        menu += `_Digite o comando seguido do prefixo ! para usar._`;

        await sock.sendMessage(jid, { text: menu }, { quoted: msg });
    }
}