import { Command } from './Command.js';
import { WASocket, WAMessage } from '@whiskeysockets/baileys';

export class LookCommand implements Command {
    name = 'look';
    description = 'Verifica dados da conversa ou do usuário. Use !look @me ou marque alguém.';
    aliases = ['l'];

    async execute(sock: WASocket, msg: WAMessage, args: string[]): Promise<void> {
        const remoteJid = msg.key.remoteJid;
        if (!remoteJid) return;

        const firstArg = args[0]?.toLowerCase();
        const isQuoted = msg.message?.extendedTextMessage?.contextInfo?.participant;
        const isMentioned = !!msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.length;

        // CASO 1: Apenas !look (Dados da Conversa)
        if (!firstArg && !isQuoted && !isMentioned) {
            console.log("🔍 Modo: Dados da Conversa");
            const response = `📂 *Dados da Conversa:*\n\n` +
                             `🆔 *ID:* ${remoteJid}\n` +
                             `👥 *Tipo:* ${remoteJid.endsWith('@g.us') ? 'Grupo' : 'Chat Privado'}`;

            await sock.sendMessage(remoteJid, { text: response }, { quoted: msg });
            return;
        }

        // CASO 2: !look @me ou !look me (Dados do Autor)
        let targetId: string | undefined;

        if (firstArg === 'me') {
            targetId = msg.key.participant ?? msg.key.remoteJid ?? (sock as any)?.user?.id ?? undefined;
        } 
        // CASO 3: Resposta (Quoted)
        else if (isQuoted) {
            targetId = msg.message?.extendedTextMessage?.contextInfo?.participant!;
        }
        // CASO 4: Menção (@)
        else if (isMentioned) {
            targetId = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid![0];
        }

        // Resposta para dados de Usuário
        if (targetId) {
            const ppUrl = await sock.profilePictureUrl(targetId, 'image').catch(() => null);
            const statusData: any = await sock.fetchStatus(targetId).catch(() => null);

            // 1. Coleta apenas o que existe
            const nomePerfil = (targetId === (msg.key.participant ?? msg.key.remoteJid)) 
                ? msg.pushName 
                : (msg.message?.extendedTextMessage?.contextInfo as any)?.pushName;

            const bio = (statusData && typeof statusData.status === 'string') ? statusData.status : null;

            // 2. Monta as linhas dinamicamente (se não existe, não aparece)
            let infoRows = [`👤 *Informações do Usuário:*`, `🆔 *ID:* ${targetId}`];

            // if (nomePerfil) infoRows.push(`📛 *Nome:* ${nomePerfil}`);
            if (bio) infoRows.push(`📝 *Bio:* ${bio}`);

            const caption = infoRows.join('\n');

            // 3. Envio condicional
            if (ppUrl) {
                await sock.sendMessage(remoteJid, { 
                    image: { url: ppUrl }, 
                    caption: caption,
                    mentions: [targetId]
                }, { quoted: msg });
            } else {
                await sock.sendMessage(remoteJid, { 
                    text: caption,
                    mentions: [targetId] 
                }, { quoted: msg });
            }
        } else {
            // Fallback: instrução de uso quando não foi possível resolver alvo
            await sock.sendMessage(remoteJid, { text: 'Use: !look, !look me, responder a uma mensagem com !look, ou mencionar alguém com !look @usuario' }, { quoted: msg });
        }
    }
}