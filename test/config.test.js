const test = require('node:test');
const assert = require('node:assert/strict');

const {getProfiles, loadConfigForProfile} = require('../src/settings/config');

function withEnv(overrides, fn) {
    const previous = {...process.env};
    process.env = {...previous, ...overrides};
    try {
        return fn();
    } finally {
        process.env = previous;
    }
}

function requiredBaseEnv() {
    return {
        DVELOP_SCRIPT_URL: 'https://example.org/script',
        DVELOP_API_KEY: 'key',
        SMTP_HOST: 'smtp.example.org',
        SMTP_FROM: 'noreply@example.org'
    };
}

function baseSettings(overrides = {}) {
    return {
        profiles: [
            {
                id: 'p1',
                name: 'Eigentümer 1',
                objectNumbers: '1001',
                mailTo: 'test@example.org',
                mailSubject: 'Betreff 1',
                mailText: 'Text 1',
                invoicePeriodStart: '',
                invoicePeriodEnd: '',
                cronExpression: '0 6 1 * *'
            }
        ],
        cronTimezone: 'Europe/Berlin',
        ...overrides
    };
}

test('getProfiles liefert konfigurierte Profile', () => {
    const profiles = getProfiles(baseSettings());
    assert.equal(profiles.length, 1);
    assert.equal(profiles[0].name, 'Eigentümer 1');
});

test('loadConfigForProfile nutzt standardmäßig previous_month', () => {
    withEnv(requiredBaseEnv(), () => {
        const profile = getProfiles(baseSettings())[0];
        const config = loadConfigForProfile(baseSettings(), profile);
        assert.deepEqual(config.invoicePeriod, {mode: 'previous_month'});
        assert.equal(config.mailSubject, 'Betreff 1');
        assert.equal(config.mailText, 'Text 1');
    });
});

test('loadConfigForProfile leitet bei weekly-Cron previous_weeks ab', () => {
    withEnv(requiredBaseEnv(), () => {
        const settings = baseSettings({
            profiles: [{
                id: 'p1',
                name: 'Eigentümer 1',
                objectNumbers: '1001',
                mailTo: 'test@example.org',
                mailSubject: 'Betreff 1',
                mailText: 'Text 1',
                invoicePeriodStart: '',
                invoicePeriodEnd: '',
                cronExpression: '0 6 * * 1'
            }]
        });
        const config = loadConfigForProfile(settings, getProfiles(settings)[0]);
        assert.deepEqual(config.invoicePeriod, {mode: 'previous_weeks', weeks: 1});
    });
});

test('loadConfigForProfile leitet bei */14-Cron previous_weeks mit 2 Wochen ab', () => {
    withEnv(requiredBaseEnv(), () => {
        const settings = baseSettings({
            profiles: [{
                id: 'p1',
                name: 'Eigentümer 1',
                objectNumbers: '1001',
                mailTo: 'test@example.org',
                mailSubject: 'Betreff 1',
                mailText: 'Text 1',
                invoicePeriodStart: '',
                invoicePeriodEnd: '',
                cronExpression: '0 6 */14 * *'
            }]
        });
        const config = loadConfigForProfile(settings, getProfiles(settings)[0]);
        assert.deepEqual(config.invoicePeriod, {mode: 'previous_weeks', weeks: 2});
    });
});

test('loadConfigForProfile leitet bei quartalsweisem Cron previous_quarter ab', () => {
    withEnv(requiredBaseEnv(), () => {
        const settings = baseSettings({
            profiles: [{
                id: 'p1',
                name: 'Eigentümer 1',
                objectNumbers: '1001',
                mailTo: 'test@example.org',
                mailSubject: 'Betreff 1',
                mailText: 'Text 1',
                invoicePeriodStart: '',
                invoicePeriodEnd: '',
                cronExpression: '0 6 1 */3 *'
            }]
        });
        const config = loadConfigForProfile(settings, getProfiles(settings)[0]);
        assert.deepEqual(config.invoicePeriod, {mode: 'previous_quarter'});
    });
});

test('loadConfigForProfile akzeptiert custom_range mit Start und Ende', () => {
    withEnv(requiredBaseEnv(), () => {
        const settings = baseSettings({
            profiles: [{
                id: 'p1',
                name: 'Eigentümer 1',
                objectNumbers: '1001',
                mailTo: 'test@example.org',
                mailSubject: 'Betreff 2',
                mailText: 'Text 2',
                invoicePeriodStart: '2026-02-10',
                invoicePeriodEnd: '2026-02-28',
                cronExpression: '0 6 1 * *'
            }]
        });
        const config = loadConfigForProfile(settings, getProfiles(settings)[0]);
        assert.deepEqual(config.invoicePeriod, {mode: 'custom_range', startDate: '2026-02-10', endDate: '2026-02-28'});
    });
});

test('loadConfigForProfile wirft Fehler, wenn nur Start oder nur Ende gesetzt ist', () => {
    withEnv(requiredBaseEnv(), () => {
        const settings = baseSettings({
            profiles: [{
                id: 'p1',
                name: 'Eigentümer 1',
                objectNumbers: '1001',
                mailTo: 'test@example.org',
                mailSubject: 'Betreff 3',
                mailText: 'Text 3',
                invoicePeriodStart: '2026-02-10',
                invoicePeriodEnd: '',
                cronExpression: '0 6 1 * *'
            }]
        });
        assert.throws(() => loadConfigForProfile(settings, getProfiles(settings)[0]), /INVOICE_PERIOD_START und INVOICE_PERIOD_END gemeinsam gesetzt/);
    });
});

test('getProfiles wirft Fehler ohne Profile', () => {
    assert.throws(() => getProfiles(baseSettings({profiles: []})), /kein Profil konfiguriert/);
});
