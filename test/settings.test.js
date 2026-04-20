const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const {
    normalizeAppSettings,
    validateAppSettings,
    writeAppSettings,
    readAppSettings,
    ensureAppSettings
} = require('../src/settings/app-settings');

test('normalizeAppSettings migriert legacy objectNumbers/mailTo zu einem Standardprofil', () => {
    const normalized = normalizeAppSettings({
        objectNumbers: '109, 110',
        mailTo: 'max@example.com, anna@example.com',
        mailSubject: 'Legacy Betreff',
        mailText: 'Legacy Text',
        invoicePeriodStart: '2026-02-01',
        invoicePeriodEnd: '2026-02-28',
        cronExpression: '0 6 1 * *',
        cronTimezone: 'Europe/Berlin'
    });

    assert.equal(normalized.profiles.length, 1);
    assert.equal(normalized.profiles[0].name, 'Standard');
    assert.equal(normalized.profiles[0].objectNumbers, '109,110');
    assert.equal(normalized.profiles[0].mailTo, 'max@example.com,anna@example.com');
    assert.equal(normalized.profiles[0].mailSubject, 'Legacy Betreff');
    assert.equal(normalized.profiles[0].mailText, 'Legacy Text');
    assert.equal(normalized.profiles[0].invoicePeriodStart, '2026-02-01');
    assert.equal(normalized.profiles[0].invoicePeriodEnd, '2026-02-28');
    assert.equal(normalized.profiles[0].cronExpression, '0 6 1 * *');
});

test('validateAppSettings akzeptiert mehrere Profile', () => {
    const validated = validateAppSettings({
        profiles: [
            {id: 'p1', name: 'Eigentümer A', objectNumbers: '109,110', mailTo: 'a@example.com'},
            {id: 'p2', name: 'Eigentümer B', objectNumbers: '210', mailTo: 'b@example.com,c@example.com'}
        ],
        invoicePeriodStart: '',
        invoicePeriodEnd: '',
        cronExpression: '0 6 1 * *',
        cronTimezone: 'Europe/Berlin'
    });

    assert.equal(validated.profiles.length, 2);
    assert.equal(validated.profiles[1].mailTo, 'b@example.com,c@example.com');
});

test('validateAppSettings wirft Fehler ohne Profile', () => {
    assert.throws(
        () => validateAppSettings({profiles: [], cronExpression: '0 6 1 * *', cronTimezone: 'Europe/Berlin'}),
        /mindestens ein Profil/
    );
});

test('validateAppSettings wirft Fehler bei ungültigem MAIL_TO im Profil', () => {
    assert.throws(
        () => validateAppSettings({
            profiles: [{id: 'p1', name: 'Eigentümer A', objectNumbers: '109', mailTo: 'ungültig'}],
            invoicePeriodStart: '',
            invoicePeriodEnd: '',
            cronExpression: '0 6 1 * *',
            cronTimezone: 'Europe/Berlin'
        }),
        /Ungültige E-Mail-Adresse/
    );
});

test('writeAppSettings/readAppSettings persistieren Profile in JSON', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'invoices-settings-'));
    const settingsPath = path.join(tempDir, 'app-settings.json');

    await writeAppSettings(settingsPath, {
        profiles: [{
            id: 'p1',
            name: 'Eigentümer A',
            objectNumbers: '109',
            mailTo: 'a@example.com',
            mailSubject: 'Profil-Betreff',
            mailText: 'Profil-Text'
        }],
        invoicePeriodStart: '2026-02-01',
        invoicePeriodEnd: '2026-02-28',
        cronExpression: '0 6 1 * *',
        cronTimezone: 'Europe/Berlin'
    });

    const loaded = await readAppSettings(settingsPath);
    assert.equal(loaded.profiles.length, 1);
    assert.equal(loaded.profiles[0].name, 'Eigentümer A');
    assert.equal(loaded.profiles[0].mailTo, 'a@example.com');
    assert.equal(loaded.profiles[0].mailSubject, 'Profil-Betreff');
    assert.equal(loaded.profiles[0].mailText, 'Profil-Text');
});

test('ensureAppSettings migriert initiale Werte aus Env-Fallback', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'invoices-settings-'));
    const settingsPath = path.join(tempDir, 'app-settings.json');

    const settings = await ensureAppSettings(settingsPath, {
        OBJEKTNUMMERN: '109',
        MAIL_TO: 'max@example.com',
        MAIL_SUBJECT: 'Env Betreff',
        MAIL_TEXT: 'Env Text',
        INVOICE_PERIOD_START: '',
        INVOICE_PERIOD_END: '',
        CRON_EXPRESSION: '0 6 1 * *',
        CRON_TIMEZONE: 'Europe/Berlin'
    });

    assert.equal(settings.profiles.length, 1);
    assert.equal(settings.profiles[0].objectNumbers, '109');
    assert.equal(settings.profiles[0].mailTo, 'max@example.com');
    assert.equal(settings.profiles[0].mailSubject, 'Env Betreff');
    assert.equal(settings.profiles[0].mailText, 'Env Text');
    assert.equal(settings.profiles[0].invoicePeriodStart, '');
    assert.equal(settings.profiles[0].invoicePeriodEnd, '');
    assert.equal(settings.profiles[0].cronExpression, '0 6 1 * *');
});
