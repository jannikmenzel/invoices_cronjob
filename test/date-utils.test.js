const test = require('node:test');
const assert = require('node:assert/strict');

const {
    getPreviousMonthUtcRange,
    getPreviousWeeksUtcRange,
    getPreviousQuarterUtcRange,
    getCustomUtcRange,
    resolveInvoiceUtcRange,
    parseInvoiceDate,
    monthLabel,
    monthFileLabel,
    rangeLabel,
    rangeFileLabel
} = require('../src/invoices/date-utils');

test('getPreviousMonthUtcRange liefert Februar für Referenzdatum im März', () => {
    const reference = new Date(Date.UTC(2026, 2, 15, 10, 0, 0));
    const range = getPreviousMonthUtcRange(reference);

    assert.equal(range.start.toISOString(), '2026-02-01T00:00:00.000Z');
    assert.equal(range.end.toISOString(), '2026-02-28T23:59:59.999Z');
    assert.equal(monthLabel(range.start), 'Februar 2026');
});

test('monthLabel formatiert 2026-03 als März 2026', () => {
    const march = new Date(Date.UTC(2026, 2, 1, 0, 0, 0));
    assert.equal(monthLabel(march), 'März 2026');
});

test('monthFileLabel formatiert 2026-03 als 2026-03', () => {
    const march = new Date(Date.UTC(2026, 2, 1, 0, 0, 0));
    assert.equal(monthFileLabel(march), '2026-03');
});

test('parseInvoiceDate akzeptiert YYYY-MM-DD und lehnt ungültig ab', () => {
    const valid = parseInvoiceDate('2026-01-31');
    assert.equal(valid.toISOString(), '2026-01-31T00:00:00.000Z');

    const invalid = parseInvoiceDate('foo');
    assert.equal(invalid, null);
});

test('getCustomUtcRange nutzt Start/Ende inkl. Tagesgrenzen', () => {
    const range = getCustomUtcRange('2026-03-05', '2026-03-17');

    assert.equal(range.start.toISOString(), '2026-03-05T00:00:00.000Z');
    assert.equal(range.end.toISOString(), '2026-03-17T23:59:59.999Z');
});

test('resolveInvoiceUtcRange nutzt standardmäßig den Vormonat', () => {
    const reference = new Date(Date.UTC(2026, 6, 2, 12, 0, 0));
    const range = resolveInvoiceUtcRange({mode: 'previous_month'}, reference);

    assert.equal(monthFileLabel(range.start), '2026-06');
});

test('getPreviousWeeksUtcRange liefert bei 2 Wochen die letzten 14 Tage bis gestern', () => {
    const reference = new Date(Date.UTC(2026, 3, 16, 12, 0, 0));
    const range = getPreviousWeeksUtcRange(reference, 2);

    assert.equal(range.start.toISOString(), '2026-04-02T00:00:00.000Z');
    assert.equal(range.end.toISOString(), '2026-04-15T23:59:59.999Z');
});

test('getPreviousQuarterUtcRange liefert Q1 für Referenzdatum im Q2', () => {
    const reference = new Date(Date.UTC(2026, 4, 10, 8, 0, 0));
    const range = getPreviousQuarterUtcRange(reference);

    assert.equal(range.start.toISOString(), '2026-01-01T00:00:00.000Z');
    assert.equal(range.end.toISOString(), '2026-03-31T23:59:59.999Z');
});

test('resolveInvoiceUtcRange unterstützt previous_weeks', () => {
    const reference = new Date(Date.UTC(2026, 3, 16, 12, 0, 0));
    const range = resolveInvoiceUtcRange({mode: 'previous_weeks', weeks: 2}, reference);

    assert.equal(range.start.toISOString(), '2026-04-02T00:00:00.000Z');
    assert.equal(range.end.toISOString(), '2026-04-15T23:59:59.999Z');
});

test('rangeLabel/rangeFileLabel nutzen Quartalslabel bei vollem Quartal', () => {
    const range = getPreviousQuarterUtcRange(new Date(Date.UTC(2026, 6, 2, 12, 0, 0)));

    assert.equal(rangeLabel(range), '2. Quartal 2026');
    assert.equal(rangeFileLabel(range), '2026-Q2');
});

test('resolveInvoiceUtcRange nutzt custom_range aus der Konfiguration', () => {
    const range = resolveInvoiceUtcRange({mode: 'custom_range', startDate: '2025-11-03', endDate: '2025-11-07'});

    assert.equal(range.start.toISOString(), '2025-11-03T00:00:00.000Z');
    assert.equal(range.end.toISOString(), '2025-11-07T23:59:59.999Z');
});

test('rangeLabel/rangeFileLabel nutzen Monatslabel bei vollem Monat', () => {
    const range = getPreviousMonthUtcRange(new Date(Date.UTC(2026, 3, 10, 8, 0, 0)));

    assert.equal(rangeLabel(range), 'März 2026');
    assert.equal(rangeFileLabel(range), '2026-03');
});

test('rangeLabel/rangeFileLabel nutzen Datumsbereich bei Custom-Range', () => {
    const range = getCustomUtcRange('2026-03-05', '2026-03-17');

    assert.equal(rangeLabel(range), '2026-03-05 bis 2026-03-17');
    assert.equal(rangeFileLabel(range), '2026-03-05_bis_2026-03-17');
});

