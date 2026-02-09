import { WASocket, WAMessage } from '@whiskeysockets/baileys';
import { Command } from './commands/Command.js';
import { glob } from 'glob';
import { pathToFileURL } from 'url';

export class CommandHandler {
    private commands: Map<string, Command> = new Map();
    private prefix: string = '!';
    private isPublic: boolean = true; // Liberado para todos os grupos e PVs

    constructor() {
        this.loadCommands();
    }

    public getCommands(): Command[] {
        return Array.from(this.commands.values());
    }

    private async loadCommands() {
        const commandsPath = '/workspaces/jessapi/src/commands';
        console.log(`📂 Buscando comandos em: ${commandsPath}`);

        const files = await glob(`${commandsPath}/*.ts`, { nocase: true });
        
        for (const file of files) {
            if (file.toLowerCase().endsWith('src/commands/command.ts')) continue;

            try {
                const fileUrl = pathToFileURL(file).href;
                const module = await import(fileUrl);
                const ExportedClass = module.default || Object.values(module).find(val => typeof val === 'function');
                
                if (ExportedClass) {
                    const instance: Command = new ExportedClass();
                    if (instance.name) {
                        this.commands.set(instance.name.toLowerCase(), instance);
                        instance.aliases?.forEach(a => this.commands.set(a.toLowerCase(), instance));
                    }
                }
            } catch (error) {
                console.error(`❌ Erro ao instanciar ${file}:`, error);
            }
        }
        console.log(`✅ [CommandHandler] ${this.commands.size} gatilhos carregados.`);
    }

    public async handle(sock: WASocket, msg: WAMessage) {
        const jid = msg.key.remoteJid;
        if (!jid) return;

        const text = msg.message?.conversation || 
                     msg.message?.extendedTextMessage?.text || 
                     msg.message?.imageMessage?.caption || "";

        if (!text.startsWith(this.prefix)) return;

        const args = text.slice(this.prefix.length).trim().split(/ +/);
        const commandName = args.shift()?.toLowerCase();

        if (!commandName) return;

        const command = this.commands.get(commandName);
        if (command) {
            console.log(`🚀 Executando: !${commandName} em ${jid}`);
            await command.execute(sock, msg, args);
        } else {
            console.log(`❓ Comando !${commandName} não encontrado.`);
        }
    }
}