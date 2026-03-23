import { WASocket } from '@whiskeysockets/baileys';

export async function sendListMessage(sock: WASocket, jid: string, listMessage: any, quoted?: any) {
    // Baileys expects the interactive list inside `listMessage` envelope
    // Transform incoming helper-format into the payload shape Baileys expects
    const payload: any = {
        title: listMessage.title,
        text: listMessage.description ?? listMessage.text ?? '',
        buttonText: listMessage.buttonText,
        footer: listMessage.footerText ?? listMessage.footer,
        sections: (listMessage.sections || []).map((s: any) => ({
            title: s.title,
            rows: (s.rows || []).map((r: any) => ({
                id: r.rowId ?? r.id ?? r.title,
                title: r.title,
                description: r.description
            }))
        }))
    };

    try {
        console.log('>>> SENDING LIST PAYLOAD:', JSON.stringify(payload, null, 2));
        await sock.sendMessage(jid, payload as any, quoted ? { quoted } as any : undefined);
    } catch (err: any) {
        console.error('❌ Erro ao enviar listMessage:', err);
        // fallback: envie o texto simples para o usuário
        const fallback = (listMessage.title ? `${listMessage.title}\n\n` : '') + (listMessage.description || 'Selecione uma opção do menu.');
        await sock.sendMessage(jid, { text: fallback } as any, quoted ? { quoted } as any : undefined);
    }
}

export async function sendButtonsMessage(sock: WASocket, jid: string, text: string, footer: string, buttons: any[], quoted?: any) {
    try {
        const payload = { text, footer, buttons, headerType: 1 };
        console.log('>>> SENDING BUTTONS PAYLOAD:', JSON.stringify(payload, null, 2));
        await sock.sendMessage(jid, payload as any, quoted ? { quoted } as any : undefined);
    } catch (err) {
        console.error('❌ Erro ao enviar buttonsMessage:', err);
        // fallback to text
        await sock.sendMessage(jid, { text: `${text}\n\n${buttons.map(b => `- ${b.buttonText?.displayText || b.buttonText}`).join('\n')}` } as any, quoted ? { quoted } as any : undefined);
    }
}

export default { sendListMessage, sendButtonsMessage };
