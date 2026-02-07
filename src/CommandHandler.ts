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
        const commandsPath = '/workspaces/jessapi/src/commands';
        
        console.log(`📂 Buscando comandos em: ${commandsPath}`);

        // Pattern que aceita .ts e ignora case sensitivity
        const files = await glob(`${commandsPath}/*.ts`, { nocase: true });
        
        console.log(`📄 Arquivos encontrados brutos:`, files);

        for (const file of files) {
            // Ignora o arquivo de definição da Interface (Command.ts)
            if (file.toLowerCase().endsWith('src/commands/command.ts')) continue;

            try {
                const fileUrl = pathToFileURL(file).href;
                const module = await import(fileUrl);
                
                // Pega a classe (pode estar no 'default' ou ser a primeira exportação)
                const ExportedClass = module.default || Object.values(module).find(val => typeof val === 'function');
                
                if (ExportedClass) {
                    const instance: Command = new ExportedClass();
                    
                    // Verifica se a instância tem as propriedades básicas
                    if (instance.name) {
                        this.commands.set(instance.name.toLowerCase(), instance);
                        
                        if (instance.aliases) {
                            instance.aliases.forEach(alias => {
                                this.commands.set(alias.toLowerCase(), instance);
                            });
                        }
                    }
                }
            } catch (error) {
                console.error(`❌ Erro ao instanciar ${file}:`, error);
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