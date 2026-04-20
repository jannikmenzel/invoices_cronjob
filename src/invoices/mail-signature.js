const fs = require('node:fs/promises');
const path = require('node:path');

function inferContentType(filePath) {
    const extension = path.extname(filePath).toLowerCase();
    if (extension === '.png') return 'image/png';
    if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg';
    if (extension === '.gif') return 'image/gif';
    if (extension === '.svg') return 'image/svg+xml';
    if (extension === '.webp') return 'image/webp';
    return 'application/octet-stream';
}

async function loadMailSignature(signaturePath) {
    const template = await fs.readFile(signaturePath, 'utf8');
    const inlineAttachments = [];
    let imageCounter = 0;

    const html = template.replaceAll(/<img\b[^>]*\bsrc=(['"])([^'"]+)\1[^>]*>/gi, (fullMatch, quote, rawSrc) => {
        const src = String(rawSrc || '').trim();
        if (!src || /^(cid:|https?:|data:)/i.test(src)) {
            return fullMatch;
        }

        imageCounter += 1;
        const absoluteImagePath = path.resolve(path.dirname(signaturePath), src);
        const cid = `signature-image-${imageCounter}@invoices-cronjob`;

        inlineAttachments.push({
            filePath: absoluteImagePath,
            filename: path.basename(absoluteImagePath),
            cid,
            contentType: inferContentType(absoluteImagePath)
        });

        return fullMatch.replace(`src=${quote}${rawSrc}${quote}`, `src=${quote}cid:${cid}${quote}`);
    });

    const resolvedAttachments = [];
    for (const attachment of inlineAttachments) {
        const content = await fs.readFile(attachment.filePath);
        resolvedAttachments.push({
            filename: attachment.filename,
            content,
            contentType: attachment.contentType,
            cid: attachment.cid,
            contentDisposition: 'inline'
        });
    }

    return {
        html,
        inlineAttachments: resolvedAttachments
    };
}

module.exports = {
    loadMailSignature
};

