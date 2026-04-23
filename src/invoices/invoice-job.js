const fs = require('node:fs/promises');
const path = require('node:path');
const {searchDocumentsByObjectNumberAndType, filterDocumentsForRange, downloadPdf} = require('./dvelop-client');
const {mergeAndCompressPdfBuffers} = require('./pdf-merge');
const {sendMailWithMultipleAttachments} = require('./mailer');
const {loadMailSignature} = require('./mail-signature');
const {resolveInvoiceUtcRange, rangeLabel, rangeFileLabel} = require('./date-utils');

const MAIL_DISCLAIMER = 'Hinweis: Diese E-Mail wurde automatisch erstellt und versendet.';

const DATE_FIELD_MAPPING = {
    'Eingangsrechnung': 'Rechnungsdatum',
    'Kontoauszug': 'Datum'
};

function getDateFieldForDocumentType(documentType) {
    return DATE_FIELD_MAPPING[documentType] || 'Datum';
}

function sanitizeFilename(value) {
    return String(value || 'Dokument')
        .replaceAll(/[^a-zA-Z0-9-_ ]/g, '_')
        .trim()
        .slice(0, 120);
}

async function ensureDir(dirPath) {
    await fs.mkdir(dirPath, {recursive: true});
}

function buildMailTextBody(introText, label, documentGroups) {
    const intro = String(introText || '').trim();

    const groupLines = [];
    for (const group of documentGroups) {
        groupLines.push(`\n${group.documentType} (${group.count} Dokumente):`);
        for (const item of group.documents) {
            groupLines.push(`  - [${item.objectNumber}] ${item.caption}`);
        }
    }

    const footerLines = [
        `\nDie E-Mail enthält folgende Dokumente für den Zeitraum ${label}:`,
        ...groupLines,
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

function buildMailHtmlBody(introText, label, documentGroups, signatureHtml = '') {
    const intro = String(introText || '').trim();
    const introHtml = intro
        ? `<p>${escapeHtml(intro).replaceAll('\n', '<br/>')}</p>`
        : '';

    let groupsHtml = '';
    for (const group of documentGroups) {
        const listItems = group.documents
            .map((item) => `<li>[${escapeHtml(item.objectNumber)}] ${escapeHtml(item.caption)}</li>`)
            .join('');

        groupsHtml += `<h3>${escapeHtml(group.documentType)} (${group.count} Dokumente)</h3><ol>${listItems}</ol>`;
    }

    const footerHtml = `<p>Die E-Mail enthält folgende Dokumente für den Zeitraum ${escapeHtml(label)}:</p>${groupsHtml}<p><strong>${escapeHtml(MAIL_DISCLAIMER)}</strong></p>`;
    const signatureBlock = signatureHtml ? `\n${signatureHtml}` : '';

    return `${introHtml}${introHtml ? '\n\n' : ''}${footerHtml}${signatureBlock}`;
}

async function runInvoiceJob(config) {
    const range = resolveInvoiceUtcRange(config.invoicePeriod);
    const label = rangeLabel(range);
    const fileLabel = rangeFileLabel(range);
    console.log(`[job] Starte Verarbeitung für ${label}`);

    const objectNumbers = Array.isArray(config.objectNumbers)
        ? config.objectNumbers
        : [config.objectNumbers];

    let documentTypes = config.documents;
    if (!documentTypes) {
        documentTypes = ['Eingangsrechnung'];
    } else if (!Array.isArray(documentTypes)) {
        documentTypes = [documentTypes];
    }
    console.log(`[job] Dokumententypen: ${JSON.stringify(documentTypes)}`);

    const documentGroups = [];

    for (const documentType of documentTypes) {
        console.log(`[job] Verarbeite Dokumententyp: ${documentType}`);
        const dateFieldName = getDateFieldForDocumentType(documentType);
        console.log(`[job] Verwende Datumsfeld: "${dateFieldName}"`);

        const selectedDocs = [];

        for (const objectNumber of objectNumbers) {
            const found = await searchDocumentsByObjectNumberAndType({
                scriptUrl: config.dvelopScriptUrl,
                apiKey: config.dvelopApiKey,
                objectNumber,
                documentTypes: [documentType]
            });

            const filtered = filterDocumentsForRange(found, range, dateFieldName);
            console.log(`[job] Objektnummer ${objectNumber}: ${filtered.length} Dokument(e) vom Typ "${documentType}" im Zeitraum ${label}.`);

            for (const doc of filtered) {
                selectedDocs.push({
                    objectNumber,
                    caption: doc.caption || 'Unbenannt',
                    document: doc
                });
            }
        }

        if (selectedDocs.length === 0) {
            console.log(`[job] Keine Dokumente vom Typ "${documentType}" gefunden.`);
            continue;
        }

        const downloadedDocs = [];
        for (const entry of selectedDocs) {
            const pdfBuffer = await downloadPdf(
                entry.document,
                config.dvelopApiKey,
                config.dvelopBaseUrl,
                config.dvelopRepoId
            );

            downloadedDocs.push({
                objectNumber: entry.objectNumber,
                caption: entry.caption,
                buffer: pdfBuffer
            });
        }

        const pdfBuffers = downloadedDocs.map(item => item.buffer);
        const mergedPdf = await mergeAndCompressPdfBuffers(pdfBuffers);

        const safeTypeName = sanitizeFilename(documentType);
        const mergedFilename = `${safeTypeName}_${fileLabel}.pdf`;

        documentGroups.push({
            documentType,
            count: downloadedDocs.length,
            documents: downloadedDocs.map(d => ({ objectNumber: d.objectNumber, caption: d.caption })),
            mergedPdf,
            mergedFilename
        });

        console.log(`[job] ${downloadedDocs.length} Dokumente vom Typ "${documentType}" zu einer PDF gemergt.`);
    }

    if (documentGroups.length === 0) {
        console.log('[job] Keine Dokumente gefunden. Versand wird übersprungen.');
        return {sent: false, count: 0};
    }

    await ensureDir(config.tempDir);

    const savedFiles = [];
    for (const group of documentGroups) {
        const filePath = path.join(config.tempDir, group.mergedFilename);
        await fs.writeFile(filePath, group.mergedPdf);
        savedFiles.push(filePath);
        console.log(`[job] Gemergte PDF gespeichert: ${filePath}`);
    }

    const defaultSubject = `Zustellung der Dokumente ${label}`;
    const textBody = buildMailTextBody(config.mailText, label, documentGroups);
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

    const htmlBody = buildMailHtmlBody(config.mailText, label, documentGroups, signatureHtml);

    const attachments = documentGroups.map((group) => ({
        filename: group.mergedFilename,
        content: group.mergedPdf,
        contentType: 'application/pdf'
    }));

    await sendMailWithMultipleAttachments({
        config,
        subject: config.mailSubject || defaultSubject,
        textBody,
        htmlBody,
        attachments,
        inlineAttachments
    });

    console.log(`[job] Mail mit ${attachments.length} Anhängen erfolgreich versendet an: ${config.mailTo.join(', ')}`);

    if (!config.keepTempFiles) {
        for (const filePath of savedFiles) {
            await fs.unlink(filePath).catch(() => undefined);
        }
    }

    return {
        sent: true,
        totalDocuments: documentGroups.reduce((sum, g) => sum + g.count, 0),
        documentGroups: documentGroups.map(g => ({ type: g.documentType, count: g.count })),
        savedFiles: config.keepTempFiles ? savedFiles : []
    };
}

module.exports = {
    runInvoiceJob,
    buildMailTextBody,
    buildMailHtmlBody
};