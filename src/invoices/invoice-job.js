const fs = require('node:fs/promises');
const path = require('node:path');
const {searchInvoicesByObjectNumber, filterInvoicesForRange, downloadPdf} = require('./dvelop-client');
const {mergePdfBuffers} = require('./pdf-merge');
const {sendMailWithAttachment} = require('./mailer');
const {loadMailSignature} = require('./mail-signature');
const {resolveInvoiceUtcRange, rangeLabel, rangeFileLabel} = require('./date-utils');

const MAIL_DISCLAIMER = 'Hinweis: Diese E-Mail wurde automatisch erstellt und versendet.';

function sanitizeFilename(value) {
    return String(value || 'Rechnung')
        .replaceAll(/[^a-zA-Z0-9-_ ]/g, '_')
        .trim()
        .slice(0, 120);
}

async function ensureDir(dirPath) {
    await fs.mkdir(dirPath, {recursive: true});
}

function buildMailTextBody(introText, label, downloaded) {
    const intro = String(introText || '').trim();
    const footerLines = [
        `Die PDF beinhaltet folgende Dokumente für den Zeitraum ${label}:`,
        ...downloaded.map((item, index) => `${index + 1}. [${item.objectNumber}] ${item.caption}`),
        '',
        MAIL_DISCLAIMER
    ];

    if (!intro) {
        return footerLines.join('\n');
    }

    return `${intro}\n\n${footerLines.join('\n')}`;
}

function escapeHtml(value) {
    return String(value || '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function buildMailHtmlBody(introText, label, downloaded, signatureHtml = '') {
    const intro = String(introText || '').trim();
    const introHtml = intro
        ? `<p>${escapeHtml(intro).replaceAll('\n', '<br/>')}</p>`
        : '';

    const listItems = downloaded
        .map((item) => `<li>[${escapeHtml(item.objectNumber)}] ${escapeHtml(item.caption)}</li>`)
        .join('');

    const footerHtml = `<p>Die PDF beinhaltet folgende Dokumente für den Zeitraum ${escapeHtml(label)}:</p><ol>${listItems}</ol><p><strong>${escapeHtml(MAIL_DISCLAIMER)}</strong></p>`;
    const signatureBlock = signatureHtml ? `\n${signatureHtml}` : '';

    return `${introHtml}${introHtml ? '\n\n' : ''}${footerHtml}${signatureBlock}`;
}

async function runInvoiceJob(config) {
    const range = resolveInvoiceUtcRange(config.invoicePeriod);
    const label = rangeLabel(range);
    const fileLabel = rangeFileLabel(range);
    console.log(`[job] Starte Verarbeitung für ${label}`);

    const selectedDocs = [];

    for (const objectNumber of config.objectNumbers) {
        const found = await searchInvoicesByObjectNumber({
            scriptUrl: config.dvelopScriptUrl,
            apiKey: config.dvelopApiKey,
            objectNumber
        });

        const filtered = filterInvoicesForRange(found, range);
        console.log(`[job] Objektnummer ${objectNumber}: ${filtered.length} Rechnung(en) im Zeitraum ${label}.`);

        for (const doc of filtered) {
            selectedDocs.push({
                objectNumber,
                caption: doc.caption || 'Unbenannt',
                document: doc
            });
        }
    }

    if (selectedDocs.length === 0) {
        console.log('[job] Keine Rechnungen gefunden. Versand wird übersprungen.');
        return {sent: false, count: 0};
    }

    const downloaded = [];
    for (const entry of selectedDocs) {
        const pdfBuffer = await downloadPdf(
            entry.document,
            config.dvelopApiKey,
            config.dvelopBaseUrl,
            config.dvelopRepoId
        );
        downloaded.push({
            objectNumber: entry.objectNumber,
            caption: entry.caption,
            filename: `${sanitizeFilename(entry.caption)}.pdf`,
            buffer: pdfBuffer
        });
    }

    const mergedPdf = await mergePdfBuffers(downloaded.map((item) => item.buffer));

    await ensureDir(config.tempDir);
    const mergedFilename = `Eingangsrechnungen_${fileLabel}.pdf`;
    const mergedPath = path.join(config.tempDir, mergedFilename);
    await fs.writeFile(mergedPath, mergedPdf);
    console.log(`[job] Gemergte PDF gespeichert: ${mergedPath}`);

    const defaultSubject = `Zustellung der Eingangsrechnungen ${label}`;
    const textBody = buildMailTextBody(config.mailText, label, downloaded);
    const signaturePath = path.resolve(__dirname, '../../public/signature/index.html');
    let signatureHtml = '';
    let inlineAttachments = [];

    try {
        const signature = await loadMailSignature(signaturePath);
        signatureHtml = signature.html;
        inlineAttachments = signature.inlineAttachments;
    } catch (error) {
        console.warn(`[job] Signatur konnte nicht geladen werden (${signaturePath}): ${error.message}`);
    }

    const htmlBody = buildMailHtmlBody(config.mailText, label, downloaded, signatureHtml);

    await sendMailWithAttachment({
        config,
        subject: config.mailSubject || defaultSubject,
        textBody,
        htmlBody,
        attachmentName: mergedFilename,
        attachmentBuffer: mergedPdf,
        inlineAttachments
    });

    console.log(`[job] Mail erfolgreich versendet an: ${config.mailTo.join(', ')}`);

    if (!config.keepTempFiles) {
        await fs.unlink(mergedPath).catch(() => undefined);
    }

    return {
        sent: true,
        count: downloaded.length,
        mergedPath
    };
}

module.exports = {
    runInvoiceJob,
    buildMailTextBody,
    buildMailHtmlBody
};

