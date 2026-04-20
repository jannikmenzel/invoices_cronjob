const test = require('node:test');
const assert = require('node:assert/strict');
const {PDFDocument} = require('pdf-lib');

const {mergePdfBuffers} = require('../src/invoices/pdf-merge');

async function makeSinglePagePdf() {
    const doc = await PDFDocument.create();
    doc.addPage([200, 200]);
    const bytes = await doc.save();
    return Buffer.from(bytes);
}

test('mergePdfBuffers merged mehrere Dateien in ein PDF', async () => {
    const a = await makeSinglePagePdf();
    const b = await makeSinglePagePdf();

    const merged = await mergePdfBuffers([a, b]);
    const mergedDoc = await PDFDocument.load(merged);

    assert.equal(mergedDoc.getPageCount(), 2);
});

