const fs = require('node:fs/promises');
const path = require('node:path');
const cron = require('node-cron');
const crypto = require('node:crypto');

const DEFAULT_APP_SETTINGS = {
    profiles: [],
    cronTimezone: 'Europe/Berlin',
    auth: {
        isPasswordSet: false,
        passwordHash: null
    }
};

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
    if (!stored) return false;
    const [salt, hash] = stored.split(':');
    if (!salt || !hash) return false;
    const verifyHash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    return hash === verifyHash;
}

const DEFAULT_PROFILE = {
    name: '',
    objectNumbers: '',
    documents: 'Eingangsrechnung',
    mailTo: '',
    mailSubject: '',
    mailText: '',
    invoicePeriodStart: '',
    invoicePeriodEnd: '',
    cronExpression: '0 6 1 * *'
};

function normalizeCsv(value) {
    return String(value || '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .join(',');
}

function normalizeDocuments(value) {
    if (!value) return 'Eingangsrechnung';

    if (Array.isArray(value)) {
        return value.join(',');
    }

    return normalizeCsv(value);
}

function isIsoDateOnly(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [y, m, d] = value.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function isSimpleEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function toProfileId(index, rawName) {
    const fallback = `profil-${index + 1}`;
    const base = String(rawName || fallback)
        .toLowerCase()
        .replaceAll(/[^a-z0-9]+/g, '-')
        .replaceAll(/^-+|-+$/g, '') || fallback;
    return `${base}-${index + 1}`;
}

function normalizeProfile(rawProfile, index, legacyDefaults = {}) {
    const name = String(rawProfile?.name || '').trim();
    return {
        id: String(rawProfile?.id || '').trim() || toProfileId(index, name),
        name,
        objectNumbers: normalizeCsv(rawProfile?.objectNumbers),
        documents: normalizeDocuments(rawProfile?.documents),
        mailTo: normalizeCsv(rawProfile?.mailTo),
        mailSubject: String(rawProfile?.mailSubject || legacyDefaults.mailSubject || DEFAULT_PROFILE.mailSubject).trim(),
        mailText: String(rawProfile?.mailText || legacyDefaults.mailText || DEFAULT_PROFILE.mailText).trim(),
        invoicePeriodStart: String(rawProfile?.invoicePeriodStart || legacyDefaults.invoicePeriodStart || '').trim(),
        invoicePeriodEnd: String(rawProfile?.invoicePeriodEnd || legacyDefaults.invoicePeriodEnd || '').trim(),
        cronExpression: String(rawProfile?.cronExpression || legacyDefaults.cronExpression || DEFAULT_PROFILE.cronExpression).trim()
    };
}

function migrateLegacyProfiles(input) {
    const legacyDefaults = {
        mailSubject: String(input.mailSubject || '').trim(),
        mailText: String(input.mailText || '').trim(),
        invoicePeriodStart: String(input.invoicePeriodStart || '').trim(),
        invoicePeriodEnd: String(input.invoicePeriodEnd || '').trim(),
        cronExpression: String(input.cronExpression || DEFAULT_PROFILE.cronExpression).trim()
    };

    if (Array.isArray(input.profiles)) {
        return input.profiles.map((profile, index) => normalizeProfile(profile, index, legacyDefaults));
    }

    const legacyObjectNumbers = normalizeCsv(input.objectNumbers);
    const legacyMailTo = normalizeCsv(input.mailTo);

    if (!legacyObjectNumbers && !legacyMailTo) {
        return [];
    }

    return [
        normalizeProfile(
            {
                id: 'standard-1',
                name: 'Standard',
                objectNumbers: legacyObjectNumbers,
                documents: input.documents || 'Eingangsrechnung',
                mailTo: legacyMailTo
            },
            0,
            legacyDefaults
        )
    ];
}

function normalizeAppSettings(input) {
    const source = input || {};
    const sourceAuth = source.auth || {};
    return {
        profiles: migrateLegacyProfiles(source),
        cronTimezone: String(source.cronTimezone || DEFAULT_APP_SETTINGS.cronTimezone).trim(),
        auth: {
            isPasswordSet: Boolean(sourceAuth.isPasswordSet),
            passwordHash: sourceAuth.passwordHash || null
        }
    };
}

function validateProfile(profile, index) {
    if (!profile.name) {
        throw new Error(`Profil ${index + 1}: Name darf nicht leer sein.`);
    }

    if (!profile.objectNumbers) {
        throw new Error(`Profil ${index + 1} (${profile.name}): Mindestens eine Objektnummer ist erforderlich.`);
    }

    if (profile.documents && typeof profile.documents !== 'string') {
        throw new Error(`Profil ${index + 1} (${profile.name}): documents muss ein String oder Array sein.`);
    }

    if (!profile.mailTo) {
        throw new Error(`Profil ${index + 1} (${profile.name}): Mindestens eine E-Mail-Adresse ist erforderlich.`);
    }

    const recipients = profile.mailTo.split(',').map((entry) => entry.trim()).filter(Boolean);
    const invalidRecipient = recipients.find((entry) => !isSimpleEmail(entry));
    if (invalidRecipient) {
        throw new Error(`Profil ${index + 1} (${profile.name}): Ungültige E-Mail-Adresse: ${invalidRecipient}`);
    }

    const hasStart = Boolean(profile.invoicePeriodStart);
    const hasEnd = Boolean(profile.invoicePeriodEnd);

    if (hasStart !== hasEnd) {
        throw new Error(`Profil ${index + 1} (${profile.name}): INVOICE_PERIOD_START und INVOICE_PERIOD_END müssen beide gesetzt oder beide leer sein.`);
    }

    if (hasStart) {
        if (!isIsoDateOnly(profile.invoicePeriodStart) || !isIsoDateOnly(profile.invoicePeriodEnd)) {
            throw new Error(`Profil ${index + 1} (${profile.name}): INVOICE_PERIOD_START und INVOICE_PERIOD_END müssen im Format YYYY-MM-DD sein.`);
        }
        if (profile.invoicePeriodStart > profile.invoicePeriodEnd) {
            throw new Error(`Profil ${index + 1} (${profile.name}): INVOICE_PERIOD_START darf nicht nach INVOICE_PERIOD_END liegen.`);
        }
    }

    if (!profile.cronExpression || !cron.validate(profile.cronExpression)) {
        throw new Error(`Profil ${index + 1} (${profile.name}): CRON_EXPRESSION ist ungültig: ${profile.cronExpression || '<leer>'}`);
    }
}

function validateAppSettings(input) {
    const settings = normalizeAppSettings(input);

    if (!Array.isArray(settings.profiles) || settings.profiles.length === 0) {
        throw new Error('Es muss mindestens ein Profil vorhanden sein.');
    }

    settings.profiles.forEach((element) => {
        validateProfile(element);
    });

    if (!settings.cronTimezone) {
        throw new Error('CRON_TIMEZONE darf nicht leer sein.');
    }

    return settings;
}

async function readAppSettings(settingsPath, options = {}) {
    const allowIncomplete = options.allowIncomplete !== false;
    const content = await fs.readFile(settingsPath, 'utf8');
    const parsed = JSON.parse(content);
    const merged = {...DEFAULT_APP_SETTINGS, ...parsed};
    if (allowIncomplete) {
        return normalizeAppSettings(merged);
    }
    return validateAppSettings(merged);
}

async function writeAppSettings(settingsPath, input, options = {}) {
    const allowIncomplete = options.allowIncomplete === true;
    const merged = {...DEFAULT_APP_SETTINGS, ...input};
    const settings = allowIncomplete ? normalizeAppSettings(merged) : validateAppSettings(merged);
    const dirPath = path.dirname(settingsPath);
    await fs.mkdir(dirPath, {recursive: true});
    const tempPath = `${settingsPath}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
    await fs.rename(tempPath, settingsPath);
    return settings;
}

async function ensureAppSettings(settingsPath, env = process.env) {
    try {
        return await readAppSettings(settingsPath);
    } catch (error) {
        if (error.code !== 'ENOENT') {
            throw error;
        }
    }

    const seededProfile = {
        id: 'max-mustermann-1',
        name: 'Max Mustermann',
        objectNumbers: String(env.OBJEKTNUMMERN || '').trim(),
        documents: String(env.DOCUMENTS || 'Eingangsrechnung').trim(),
        mailTo: String(env.MAIL_TO || '').trim(),
        mailSubject: String(env.MAIL_SUBJECT || '').trim(),
        mailText: String(env.MAIL_TEXT || '').trim(),
        invoicePeriodStart: String(env.INVOICE_PERIOD_START || '').trim(),
        invoicePeriodEnd: String(env.INVOICE_PERIOD_END || '').trim(),
        cronExpression: String(env.CRON_EXPRESSION || DEFAULT_PROFILE.cronExpression).trim()
    };

    const seeded = {
        profiles: seededProfile.objectNumbers || seededProfile.mailTo ? [seededProfile] : [],
        cronTimezone: String(env.CRON_TIMEZONE || DEFAULT_APP_SETTINGS.cronTimezone).trim()
    };

    return writeAppSettings(settingsPath, seeded, {allowIncomplete: true});
}

module.exports = {
    DEFAULT_APP_SETTINGS,
    normalizeAppSettings,
    validateAppSettings,
    readAppSettings,
    writeAppSettings,
    ensureAppSettings,
    hashPassword,
    verifyPassword
};