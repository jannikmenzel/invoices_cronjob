const test = require('node:test');
const assert = require('node:assert/strict');

const {buildMailTextBody, buildMailHtmlBody} = require('../src/invoices/invoice-job');

test('buildMailTextBody hängt den festen Footer immer unten an', () => {
    const body = buildMailTextBody('Hallo Team,\nbitte beachten.', 'März 2026', [
        {objectNumber: '1001', caption: 'Rechnung A'},
        {objectNumber: '1002', caption: 'Rechnung B'}
    ]);

    assert.match(body, /^Hallo Team,\nbitte beachten\.\n\nDie PDF beinhaltet folgende Dokumente für den Zeitraum März 2026:/);
    assert.match(body, /\n1\. \[1001] Rechnung A\n2\. \[1002] Rechnung B\n\nHinweis: Diese E-Mail wurde automatisch erstellt und versendet\.$/);
});

test('buildMailTextBody liefert nur den festen Footer, wenn kein Intro gesetzt ist', () => {
    const body = buildMailTextBody('   ', 'März 2026', [
        {objectNumber: '2001', caption: 'Rechnung X'}
    ]);

    assert.equal(
        body,
        [
            'Die PDF beinhaltet folgende Dokumente für den Zeitraum März 2026:',
            '1. [2001] Rechnung X',
            '',
            'Hinweis: Diese E-Mail wurde automatisch erstellt und versendet.'
        ].join('\n')
    );
});

test('buildMailHtmlBody escaped Intro und ergänzt Signatur-HTML', () => {
    const body = buildMailHtmlBody('Hallo <Team>\nBitte "prüfen".', 'März 2026', [
        {objectNumber: '2001', caption: 'Rechnung <X>'}
    ], '<table><tr><td>Signatur</td></tr></table>');

    assert.match(body, /^<p>Hallo &lt;Team&gt;<br\/>Bitte &quot;prüfen&quot;\.<\/p>/);
    assert.match(body, /Die PDF beinhaltet folgende Dokumente für den Zeitraum März 2026:/);
    assert.match(body, /<li>\[2001] Rechnung &lt;X&gt;<\/li>/);
    assert.match(body, /<strong>Hinweis: Diese E-Mail wurde automatisch erstellt und versendet\.<\/strong>/);
    assert.match(body, /<table><tr><td>Signatur<\/td><\/tr><\/table>$/);
});

