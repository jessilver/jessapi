import { WASocket, WAMessage } from '@whiskeysockets/baileys';
import { Command } from './commands/Command.js';
import { glob } from 'glob';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

export class CommandHandler {
    private commands: Map<string, Command> = new Map();
    private prefix: string = '!';

    constructor() {
        this.loadCommands();
    }

    private async loadCommands() {
        // Resolve o problema do import.meta usando um cast seguro para o compilador
        const currentUrl = (import.meta as any).url;
        const __dirname = path.dirname(fileURLToPath(currentUrl));
        const commandsPath = path.join(__dirname, 'commands');
        
        // Busca arquivos TS ou JS
        const files = await glob(`${commandsPath}/**/*.{ts,js}`);

        for (const file of files) {
            // Ignora a interface base
            if (file.endsWith('Command.ts') || file.endsWith('Command.js')) continue;

            try {
                const fileUrl = pathToFileURL(file).href;
                const module = await import(fileUrl);
                
                // Pega a classe exportada
                const CommandClass = Object.values(module)[0] as any;
                
                if (CommandClass && typeof CommandClass === 'function') {
                    const instance: Command = new CommandClass();
                    
                    this.commands.set(instance.name.toLowerCase(), instance);
                    
                    if (instance.aliases) {
                        instance.aliases.forEach(alias => {
                            this.commands.set(alias.toLowerCase(), instance);
                        });
                    }
                }
            } catch (error) {
                console.error(`Erro ao carregar o comando no arquivo ${file}:`, error);
            }
        }

        console.log(`[CommandHandler] ${this.commands.size} gatilhos de comando carregados.`);
    }

    public async handle(sock: WASocket, msg: WAMessage) {
        // Extrai o texto de forma segura
        const text = msg.message?.conversation || 
                     msg.message?.extendedTextMessage?.text || 
                     msg.message?.imageMessage?.caption || 
                     "";

        if (!text.startsWith(this.prefix)) return;

        const args = text.slice(this.prefix.length).trim().split(/ +/);
        const commandName = args.shift()?.toLowerCase();

        if (!commandName) return;

        const command = this.commands.get(commandName);

        if (command) {
            try {
                // Agora 'msg' é WAMessage, compatível com os comandos
                await command.execute(sock, msg, args);
            } catch (error) {
                const jid = msg.key?.remoteJid;

                if (!jid) {
                    console.error("Erro: remoteJid não encontrado.");
                    return;
                }

                console.error(`Erro ao executar !${commandName}:`, error);
                await sock.sendMessage(jid, { text: '❌ Ocorreu um erro ao executar este comando.' });
            }
        }
    }
}