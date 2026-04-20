const path = require('node:path');
const os = require('node:os');

function parseBool(value, defaultValue = false) {
    if (value == null) return defaultValue;
    return ['1', 'true', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function parseCsv(value) {
    return String(value || '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
}

function required(name) {
    const value = process.env[name];
    if (!value || !String(value).trim()) {
        throw new Error(`Fehlende Umgebungsvariable: ${name}`);
    }
    return value.trim();
}

function parsePort(value, defaultValue) {
    const raw = value == null || value === '' ? String(defaultValue) : String(value);
    const port = Number(raw);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error(`Ungültiger SMTP-Port: ${raw}`);
    }
    return port;
}

function splitCron(rawExpression) {
    const parts = String(rawExpression || '').trim().split(/\s+/).filter(Boolean);
    if (parts.length !== 5) return null;
    return {
        minute: parts[0],
        hour: parts[1],
        dayOfMonth: parts[2],
        month: parts[3],
        dayOfWeek: parts[4]
    };
}

function isNumericCronField(value) {
    return /^\d+$/.test(value);
}

function inferInvoicePeriodFromCron(cronExpression) {
    const cronParts = splitCron(cronExpression);
    if (!cronParts) return {mode: 'previous_month'};

    const {dayOfMonth, month, dayOfWeek} = cronParts;
    const isQuarterly = month === '*/3' || month === '1,4,7,10';
    if (isQuarterly && isNumericCronField(dayOfMonth)) {
        return {mode: 'previous_quarter'};
    }

    if (dayOfMonth === '*/14' && month === '*' && dayOfWeek === '*') {
        return {mode: 'previous_weeks', weeks: 2};
    }

    const isWeekly = dayOfMonth === '*' && month === '*' && dayOfWeek !== '*';
    if (isWeekly) {
        return {mode: 'previous_weeks', weeks: 1};
    }

    const isMonthly = isNumericCronField(dayOfMonth) && month === '*' && dayOfWeek === '*';
    if (isMonthly) {
        return {mode: 'previous_month'};
    }

    return {mode: 'previous_month'};
}

function parseInvoicePeriodConfig(profile) {
    const startDate = String(profile.invoicePeriodStart || '').trim();
    const endDate = String(profile.invoicePeriodEnd || '').trim();

    if (!startDate && !endDate) {
        return inferInvoicePeriodFromCron(profile.cronExpression);
    }

    if (!startDate || !endDate) {
        throw new Error('Für eine Custom-Range müssen INVOICE_PERIOD_START und INVOICE_PERIOD_END gemeinsam gesetzt sein.');
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
        throw new Error('Ungültige Custom-Range. Erwartetes Datumsformat: YYYY-MM-DD.');
    }

    if (startDate > endDate) {
        throw new Error('Ungültige Custom-Range: INVOICE_PERIOD_START darf nicht nach INVOICE_PERIOD_END liegen.');
    }

    return {
        mode: 'custom_range',
        startDate,
        endDate
    };
}

function buildBaseConfig(appSettings) {
    if (!appSettings || typeof appSettings !== 'object') {
        throw new Error('Fehlende App-Settings.');
    }

    const dvelopScriptUrl = required('DVELOP_SCRIPT_URL');

    let dvelopBaseUrl = process.env.DVELOP_BASE_URL;
    if (!dvelopBaseUrl) {
        dvelopBaseUrl = new URL(dvelopScriptUrl).origin;
    }

    return {
        dvelopApiKey: required('DVELOP_API_KEY'),
        dvelopScriptUrl,
        dvelopBaseUrl,
        dvelopRepoId: (process.env.DVELOP_REPO_ID || '').trim() || null,
        cronTimezone: appSettings.cronTimezone,
        runOnStartup: false,
        smtpHost: required('SMTP_HOST'),
        smtpPort: parsePort(process.env.SMTP_PORT, 25),
        smtpSecure: parseBool(process.env.SMTP_SECURE, false),
        smtpRequireTls: parseBool(process.env.SMTP_REQUIRE_TLS, false),
        smtpUser: (process.env.SMTP_USER || '').trim() || null,
        smtpPass: (process.env.SMTP_PASS || '').trim() || null,
        smtpFrom: required('SMTP_FROM'),
        mailCc: [],
        maxAttachmentBytes: 3145728,
        tempDir: path.join(os.tmpdir(), 'invoices_cronjob'),
        keepTempFiles: false
    };
}

function getProfiles(appSettings) {
    const profiles = Array.isArray(appSettings?.profiles) ? appSettings.profiles : [];
    if (profiles.length === 0) {
        throw new Error('Es ist kein Profil konfiguriert. Bitte mindestens ein Eigentümer-Profil anlegen.');
    }
    return profiles;
}

function loadConfigForProfile(appSettings, profile) {
    const objectNumbers = parseCsv(profile.objectNumbers);
    if (objectNumbers.length === 0) {
        throw new Error(`Profil ${profile.name}: OBJEKTNUMMERN muss mindestens eine Objektnummer enthalten.`);
    }

    const mailTo = parseCsv(profile.mailTo);
    if (mailTo.length === 0) {
        throw new Error(`Profil ${profile.name}: MAIL_TO muss mindestens eine E-Mail-Adresse enthalten.`);
    }

    const base = buildBaseConfig(appSettings);
    return {
        ...base,
        ownerName: profile.name,
        cronExpression: String(profile.cronExpression || '').trim(),
        objectNumbers,
        mailTo,
        mailSubject: String(profile.mailSubject || '').trim(),
        mailText: String(profile.mailText || '').trim(),
        invoicePeriod: parseInvoicePeriodConfig(profile)
    };
}

module.exports = {
    loadConfigForProfile,
    getProfiles
};
