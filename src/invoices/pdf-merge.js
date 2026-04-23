const { PDFDocument } = require('pdf-lib');
const { execFile } = require('node:child_process');
const fs = require('node:fs');

async function mergePdfBuffers(pdfBuffers) {
    if (!Array.isArray(pdfBuffers) || pdfBuffers.length === 0) {
        throw new Error('Es wurden keine PDFs zum Mergen übergeben.');
    }

    const target = await PDFDocument.create();

    for (const buffer of pdfBuffers) {
        const source = await PDFDocument.load(buffer, { ignoreEncryption: true });
        const pages = await target.copyPages(source, source.getPageIndices());

        for (const page of pages) {
            target.addPage(page);
        }
    }

    const bytes = await target.save({
        useObjectStreams: true,
        addDefaultPage: false,
        objectsPerTick: 50
    });

    return Buffer.from(bytes);
}


async function compressPdf(buffer) {
    const input = `/tmp/in-${Date.now()}.pdf`;
    const output = `/tmp/out-${Date.now()}.pdf`;

    fs.writeFileSync(input, buffer);

    const args = [
        '-sDEVICE=pdfwrite',
        '-dCompatibilityLevel=1.4',
        '-dPDFSETTINGS=/screen',
        '-dDetectDuplicateImages=true',
        '-dCompressFonts=true',
        '-dDownsampleColorImages=true',
        '-dColorImageResolution=120',
        '-dDownsampleGrayImages=true',
        '-dGrayImageResolution=120',
        '-dDownsampleMonoImages=true',
        '-dMonoImageResolution=120',
        '-dNOPAUSE',
        '-dQUIET',
        '-dBATCH',
        `-sOutputFile=${output}`,
        input
    ];

    await new Promise((resolve, reject) => {
        execFile('gs', args, (err) => {
            if (err) return reject(err);
            resolve();
        });
    });

    const result = fs.readFileSync(output);

    fs.unlinkSync(input);
    fs.unlinkSync(output);

    return result;
}

async function mergeAndCompressPdfBuffers(pdfBuffers) {
    const merged = await mergePdfBuffers(pdfBuffers);
    return await compressPdf(merged);
}

module.exports = {
    mergePdfBuffers,
    mergeAndCompressPdfBuffers
};