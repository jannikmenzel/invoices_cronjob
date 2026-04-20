const nodemailer = require('nodemailer');

async function sendMailWithAttachment({
                                          config,
                                          subject,
                                          textBody,
                                          htmlBody,
                                          attachmentName,
                                          attachmentBuffer,
                                          inlineAttachments = []
                                      }) {
    if (attachmentBuffer.length > config.maxAttachmentBytes) {
        throw new Error(
            `Attachment ist zu groß (${attachmentBuffer.length} Bytes). Maximal erlaubt: ${config.maxAttachmentBytes} Bytes.`
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
        requireTLS: config.smtpRequireTls
    });

    await transporter.sendMail({
        from: config.smtpFrom,
        to: config.mailTo,
        cc: config.mailCc.length > 0 ? config.mailCc : undefined,
        subject,
        text: textBody,
        html: htmlBody,
        attachments: [
            {
                filename: attachmentName,
                content: attachmentBuffer,
                contentType: 'application/pdf'
            },
            ...inlineAttachments
        ]
    });
}

module.exports = {
    sendMailWithAttachment
};

