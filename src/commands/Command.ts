import { WASocket, WAMessage } from '@whiskeysockets/baileys';

export interface Command {
    name: string;
    description: string;
    aliases: string[];
    execute(sock: WASocket, msg: WAMessage, args: string[]): Promise<void>;
}