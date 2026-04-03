import { WASocket, WAMessage } from '@whiskeysockets/baileys';
import { Command } from './commands/Command.js';
import { glob } from 'glob';
import { pathToFileURL } from 'url';

export class CommandHandler {
    private commands: Map<string, Command> = new Map();
    private prefix: string = '!';
    private isPublic: boolean = true; // Liberado para todos os grupos e PVs

    constructor() {
        // Commands are loaded explicitly via `loadCommands()` to avoid
        // race conditions during async initialization. Call `await handler.loadCommands()`
        // from your startup code before handling messages.
    }

    public getCommands(): Command[] {
        return Array.from(this.commands.values());
    }

    public async loadCommands() {
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

        // Normalize text from different interactive responses (list/buttons) and regular messages
        let text = msg.message?.conversation ||
                   msg.message?.extendedTextMessage?.text ||
                   msg.message?.imageMessage?.caption || "";

        // Handle list responses (user tapped a list item)
        const listResp = msg.message?.listResponseMessage;
        // Baileys typing: selected row can be under `singleSelectReply.selectedRowId`
        const selectedRowId = listResp?.singleSelectReply?.selectedRowId;
        if (listResp && selectedRowId) {
            const rowId: string = selectedRowId;
            console.log(`📋 listResponse selectedRowId=${rowId}`);

            if (rowId.startsWith('ACTION:')) {
                const action = rowId.split(':')[1];
                // Implement known actions
                if (action === 'look_mention') {
                    await sock.sendMessage(jid, { text: 'Para usar o modo "marcar": mencione alguém com @ ou responda a uma mensagem com !look.' }, { quoted: msg });
                }
                return;
            }

            // If rowId is a command wrapped as CMD:!ping => extract
            if (rowId.startsWith('CMD:')) text = rowId.split(':')[1];
            else text = rowId;
        }

        // Handle buttons responses (user tapped a quick button)
        const btnResp = msg.message?.buttonsResponseMessage;
        if (btnResp && btnResp.selectedButtonId) {
            const btnId = btnResp.selectedButtonId;
            console.log(`🔘 buttonsResponse selectedButtonId=${btnId}`);

            if (btnId.startsWith('ACTION:')) {
                const action = btnId.split(':')[1];
                if (action === 'look_mention') {
                    await sock.sendMessage(jid, { text: 'Para usar o modo "marcar": mencione alguém com @ ou responda a uma mensagem com !look.' }, { quoted: msg });
                }
                return;
            }

            if (btnId.startsWith('CMD:')) text = btnId.split(':')[1];
            else text = btnId;
        }

        if (!text.startsWith(this.prefix)) return;

        const args = text.slice(this.prefix.length).trim().split(/ +/);
        const commandName = args.shift()?.toLowerCase();

        if (!commandName) return;

        const command = this.commands.get(commandName);
        if (command) {
            console.log(`🚀 Executando: !${commandName} em ${jid}`);
            try {
                await command.execute(sock, msg, args);
            } catch (err) {
                console.error(`❌ Erro ao executar !${commandName}:`, err);
                // Informe o usuário que houve um erro durante a execução
                try {
                    await sock.sendMessage(jid, { text: `❌ Ocorreu um erro ao executar o comando !${commandName}. Tente novamente mais tarde.` }, { quoted: msg });
                } catch (sendErr) {
                    console.error('❌ Falha ao notificar usuário sobre erro do comando:', sendErr);
                }
            }
        } else {
            console.log(`❓ Comando !${commandName} não encontrado.`);
            try {
                await sock.sendMessage(jid, { text: `❓ Comando "!${commandName}" não encontrado. Use !help para ver a lista de comandos disponíveis.` }, { quoted: msg });
            } catch (sendErr) {
                console.error('❌ Falha ao notificar usuário sobre comando não encontrado:', sendErr);
            }
        }
    }
}