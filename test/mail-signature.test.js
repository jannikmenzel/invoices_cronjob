const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const {loadMailSignature} = require('../src/invoices/mail-signature');

test('loadMailSignature ersetzt lokale Bild-URLs mit CID und liefert Inline-Attachments', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'signature-test-'));
    const imageDir = path.join(tempDir, 'images');
    await fs.mkdir(imageDir, {recursive: true});

    const imagePath = path.join(imageDir, 'logo.png');
    await fs.writeFile(imagePath, Buffer.from([1, 2, 3, 4]));

    const signaturePath = path.join(tempDir, 'index.html');
    await fs.writeFile(signaturePath, '<table><tr><td><img src="images/logo.png" alt="Logo"/></td></tr></table>', 'utf8');

    const signature = await loadMailSignature(signaturePath);

    assert.match(signature.html, /src="cid:signature-image-1@invoices-cronjob"/);
    assert.equal(signature.inlineAttachments.length, 1);
    assert.equal(signature.inlineAttachments[0].filename, 'logo.png');
    assert.equal(signature.inlineAttachments[0].cid, 'signature-image-1@invoices-cronjob');
    assert.equal(signature.inlineAttachments[0].contentType, 'image/png');
    assert.deepEqual(signature.inlineAttachments[0].content, Buffer.from([1, 2, 3, 4]));

    await fs.rm(tempDir, {recursive: true, force: true});
});

test('loadMailSignature lässt externe Bilder unverändert', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'signature-test-'));
    const signaturePath = path.join(tempDir, 'index.html');
    await fs.writeFile(signaturePath, '<img src="https://example.com/logo.png"/>', 'utf8');

    const signature = await loadMailSignature(signaturePath);

    assert.equal(signature.html, '<img src="https://example.com/logo.png"/>');
    assert.equal(signature.inlineAttachments.length, 0);

    await fs.rm(tempDir, {recursive: true, force: true});
});

