import { WASocket, WAMessage } from '@whiskeysockets/baileys';
import { Command } from './commands/Command.js';
import { glob } from 'glob';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

export class CommandHandler {
    private commands: Map<string, Command> = new Map();
    private prefix: string = '!';

    private authorizedGroups: string[] = [
        '120363423834043528@g.us'
    ];

    private allowPrivate: boolean = true;

    constructor() {
        this.loadCommands();
    }

    public getCommands() {
        // Retorna uma lista de comandos únicos (sem os aliases duplicados)
        return Array.from(new Set(this.commands.values()));
    }

    private async loadCommands() {
        const __filename = fileURLToPath(import.meta.url);
        const __dirname = path.dirname(__filename);

        const cwd = process.cwd();
        const srcCommands = path.resolve(cwd, 'src', 'commands');
        const distCommands = path.resolve(cwd, 'dist', 'commands');
        const fallbackCommands = path.resolve(__dirname, 'commands');

        const commandsDir = existsSync(srcCommands)
            ? srcCommands
            : existsSync(distCommands)
                ? distCommands
                : fallbackCommands;

        // No Windows, o glob prefere barras normais (/)
        const pattern = path.resolve(commandsDir, '**', '*.{ts,js}').replace(/\\/g, '/');

        console.log(`📂 Buscando comandos em: ${commandsDir}`);

        // Busca arquivos .ts ou .js
        const files = await glob(pattern, { nodir: true });

        for (const file of files) {
            // Converte o caminho do arquivo para o formato que o glob/import gosta
            const normalizedFile = file.replace(/\\/g, '/');
            
            if (normalizedFile.endsWith('Command.ts') || normalizedFile.endsWith('Command.js')) continue;

            try {
                const fileUrl = pathToFileURL(normalizedFile).href;
                const module = await import(fileUrl);
                
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
                console.error(`❌ Erro no arquivo ${file}:`, error);
            }
        }

        console.log(`✅ [CommandHandler] ${this.commands.size} gatilhos de comando carregados.`);
    }

    public async handle(sock: WASocket, msg: WAMessage) {
        const jid = msg.key?.remoteJid;
        if (!jid) return;

        const isGroup = String(jid).endsWith('@g.us');
        const isStatus = jid === 'status@broadcast';

        // 1. Ignora status
        if (isStatus) return;

        // 2. Regra de Grupos: Se for grupo e não estiver na lista, ignora
        if (isGroup && !this.authorizedGroups.includes(String(jid))) {
            console.log(`[Segurança] Tentativa de uso em grupo não autorizado: ${jid}`);
            return; 
        }

        // 3. Regra de Privado: Se for PV e você desabilitou, ignora
        if (!isGroup && !this.allowPrivate) {
            return;
        }

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
                await command.execute(sock, msg, args);
            } catch (error) {
                console.error(`Erro ao executar !${commandName}:`, error);
                await sock.sendMessage(jid, { text: '❌ Ocorreu um erro ao executar este comando.' });
            }
        }
    }
}