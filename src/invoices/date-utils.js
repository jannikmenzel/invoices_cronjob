function getPreviousMonthUtcRange(referenceDate = new Date()) {
    const year = referenceDate.getUTCFullYear();
    const month = referenceDate.getUTCMonth();

    const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));

    return {start, end};
}

function getPreviousWeeksUtcRange(referenceDate = new Date(), weeks = 1) {
    const safeWeeks = Number.isInteger(weeks) && weeks > 0 ? weeks : 1;
    const end = new Date(Date.UTC(
        referenceDate.getUTCFullYear(),
        referenceDate.getUTCMonth(),
        referenceDate.getUTCDate() - 1,
        23,
        59,
        59,
        999
    ));
    const start = new Date(Date.UTC(
        end.getUTCFullYear(),
        end.getUTCMonth(),
        end.getUTCDate() - ((safeWeeks * 7) - 1),
        0,
        0,
        0,
        0
    ));
    return {start, end};
}

function getPreviousQuarterUtcRange(referenceDate = new Date()) {
    const year = referenceDate.getUTCFullYear();
    const month = referenceDate.getUTCMonth();
    const currentQuarterStartMonth = Math.floor(month / 3) * 3;
    const previousQuarterStartMonth = currentQuarterStartMonth - 3;
    const start = new Date(Date.UTC(year, previousQuarterStartMonth, 1, 0, 0, 0, 0));
    const end = new Date(Date.UTC(year, currentQuarterStartMonth, 0, 23, 59, 59, 999));
    return {start, end};
}

function parseDateOnlyUtc(value, envName) {
    const raw = String(value || '').trim();
    const match = new RegExp(/^(\d{4})-(\d{2})-(\d{2})$/).exec(raw);
    if (!match) {
        throw new Error(`Ungültiges Datum (${envName}): ${raw}. Erwartet: YYYY-MM-DD.`);
    }

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));

    if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day
    ) {
        throw new Error(`Ungültiges Datum (${envName}): ${raw}.`);
    }

    return date;
}

function getCustomUtcRange(startDate, endDate) {
    const start = parseDateOnlyUtc(startDate, 'INVOICE_PERIOD_START');
    const endStart = parseDateOnlyUtc(endDate, 'INVOICE_PERIOD_END');
    const end = new Date(Date.UTC(
        endStart.getUTCFullYear(),
        endStart.getUTCMonth(),
        endStart.getUTCDate(),
        23,
        59,
        59,
        999
    ));

    if (start > end) {
        throw new Error('Ungültiger Rechnungszeitraum: INVOICE_PERIOD_START darf nicht nach INVOICE_PERIOD_END liegen.');
    }

    return {start, end};
}

function resolveInvoiceUtcRange(invoicePeriod, referenceDate = new Date()) {
    const mode = invoicePeriod?.mode || 'previous_month';

    if (mode === 'previous_month') {
        return getPreviousMonthUtcRange(referenceDate);
    }

    if (mode === 'previous_weeks') {
        return getPreviousWeeksUtcRange(referenceDate, invoicePeriod.weeks);
    }

    if (mode === 'previous_quarter') {
        return getPreviousQuarterUtcRange(referenceDate);
    }

    if (mode === 'custom_range') {
        return getCustomUtcRange(invoicePeriod.startDate, invoicePeriod.endDate);
    }

    throw new Error(`Unbekannter Rechnungszeitraum-Modus: ${mode}`);
}

function parseInvoiceDate(value) {
    if (!value) return null;
    const raw = String(value).trim();
    if (!raw) return null;

    const date = new Date(`${raw}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) {
        return null;
    }

    return date;
}

function isDateWithinUtcRange(date, range) {
    return date >= range.start && date <= range.end;
}

function monthLabel(rangeStart) {
    const monthNames = [
        'Januar',
        'Februar',
        'März',
        'April',
        'Mai',
        'Juni',
        'Juli',
        'August',
        'September',
        'Oktober',
        'November',
        'Dezember'
    ];
    const month = monthNames[rangeStart.getUTCMonth()];
    const year = String(rangeStart.getUTCFullYear());
    return `${month} ${year}`;
}

function monthFileLabel(rangeStart) {
    const month = String(rangeStart.getUTCMonth() + 1).padStart(2, '0');
    const year = String(rangeStart.getUTCFullYear());
    return `${year}-${month}`;
}

function quarterLabel(rangeStart) {
    const quarter = Math.floor(rangeStart.getUTCMonth() / 3) + 1;
    return `${quarter}. Quartal ${rangeStart.getUTCFullYear()}`;
}

function quarterFileLabel(rangeStart) {
    const quarter = Math.floor(rangeStart.getUTCMonth() / 3) + 1;
    return `${rangeStart.getUTCFullYear()}-Q${quarter}`;
}

function isFullCalendarMonth(range) {
    const start = range.start;
    const expectedStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1, 0, 0, 0, 0));
    const expectedEnd = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0, 23, 59, 59, 999));
    return range.start.getTime() === expectedStart.getTime() && range.end.getTime() === expectedEnd.getTime();
}

function isFullCalendarQuarter(range) {
    const start = range.start;
    const quarterStartMonth = Math.floor(start.getUTCMonth() / 3) * 3;
    const expectedStart = new Date(Date.UTC(start.getUTCFullYear(), quarterStartMonth, 1, 0, 0, 0, 0));
    const expectedEnd = new Date(Date.UTC(start.getUTCFullYear(), quarterStartMonth + 3, 0, 23, 59, 59, 999));
    return range.start.getTime() === expectedStart.getTime() && range.end.getTime() === expectedEnd.getTime();
}

function formatIsoDate(date) {
    const year = String(date.getUTCFullYear());
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function rangeLabel(range) {
    if (isFullCalendarQuarter(range)) {
        return quarterLabel(range.start);
    }
    if (isFullCalendarMonth(range)) {
        return monthLabel(range.start);
    }
    return `${formatIsoDate(range.start)} bis ${formatIsoDate(range.end)}`;
}

function rangeFileLabel(range) {
    if (isFullCalendarQuarter(range)) {
        return quarterFileLabel(range.start);
    }
    if (isFullCalendarMonth(range)) {
        return monthFileLabel(range.start);
    }
    return `${formatIsoDate(range.start)}_bis_${formatIsoDate(range.end)}`;
}

module.exports = {
    getPreviousMonthUtcRange,
    getPreviousWeeksUtcRange,
    getPreviousQuarterUtcRange,
    getCustomUtcRange,
    resolveInvoiceUtcRange,
    parseInvoiceDate,
    isDateWithinUtcRange,
    monthLabel,
    monthFileLabel,
    rangeLabel,
    rangeFileLabel
};

