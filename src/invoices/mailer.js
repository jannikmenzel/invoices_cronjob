const nodemailer = require('nodemailer');

async function sendMailWithMultipleAttachments({
                                                   config,
                                                   subject,
                                                   textBody,
                                                   htmlBody,
                                                   attachments = [],
                                                   inlineAttachments = []
                                               }) {
    const totalSize = attachments.reduce((sum, att) => sum + (att.content?.length || 0), 0);
    if (totalSize > config.maxAttachmentBytes) {
        throw new Error(
            `Anhänge sind zu groß (${totalSize} Bytes). Maximal erlaubt: ${config.maxAttachmentBytes} Bytes.`
        );
    }

    if ((config.smtpUser && !config.smtpPass) || (!config.smtpUser && config.smtpPass)) {
        throw new Error('SMTP_USER und SMTP_PASS müssen entweder beide gesetzt oder beide leer sein.');
    }

    const transporter = nodemailer.createTransport({
        host: config.smtpHost,
        port: config.smtpPort,
        secure: config.smtpSecure,
        auth: config.smtpUser
            ? {user: config.smtpUser, pass: config.smtpPass}
            : undefined,
        ignoreTLS: true,
    });

    const allAttachments = [
        ...attachments,
        ...inlineAttachments
    ];

    await transporter.sendMail({
        from: config.smtpFrom,
        to: config.mailTo,
        cc: config.mailCc.length > 0 ? config.mailCc : undefined,
        subject,
        text: textBody,
        html: htmlBody,
        attachments: allAttachments
    });
}

module.exports = {
    sendMailWithMultipleAttachments
};