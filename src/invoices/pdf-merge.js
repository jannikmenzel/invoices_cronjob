const {PDFDocument} = require('pdf-lib');

async function mergePdfBuffers(pdfBuffers) {
    if (!Array.isArray(pdfBuffers) || pdfBuffers.length === 0) {
        throw new Error('Es wurden keine PDFs zum Mergen übergeben.');
    }

    const target = await PDFDocument.create();

    for (const buffer of pdfBuffers) {
        const source = await PDFDocument.load(buffer, {ignoreEncryption: true});
        const pages = await target.copyPages(source, source.getPageIndices());
        for (const page of pages) {
            target.addPage(page);
        }
    }

    const bytes = await target.save();
    return Buffer.from(bytes);
}

module.exports = {
    mergePdfBuffers
};

