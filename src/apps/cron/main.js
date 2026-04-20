require('dotenv/config');
const cron = require('node-cron');
const path = require('node:path');
const {loadConfigForProfile, getProfiles} = require('../../settings/config');
const {runInvoiceJob} = require('../../invoices/invoice-job');
const {startUiServer} = require('../ui/main');
const {ensureAppSettings} = require('../../settings/app-settings');

async function runProfileOnce(appSettings, profile) {
    const config = loadConfigForProfile(appSettings, profile);
    console.log(`[job] Starte Profil: ${profile.name}`);

    try {
        const result = await runInvoiceJob(config);
        return {
            profileId: profile.id,
            profileName: profile.name,
            sent: result.sent,
            count: result.count,
            ok: true
        };
    } catch (error) {
        console.error(`[job] Fehler im Profil ${profile.name}:`, error);
        return {
            profileId: profile.id,
            profileName: profile.name,
            sent: false,
            count: 0,
            ok: false,
            error: error.message || 'Unbekannter Fehler'
        };
    }
}

async function runAllProfilesOnce(appSettings, runningByProfile, options = {}) {
    const throwIfRunning = options.throwIfRunning === true;
    const profiles = getProfiles(appSettings);
    const profileResults = [];

    for (const profile of profiles) {
        const isRunning = Boolean(runningByProfile.get(profile.id));
        if (isRunning && throwIfRunning) {
            throw new Error(`Profil ${profile.name} läuft bereits. Bitte später erneut versuchen.`);
        }

        if (isRunning) {
            profileResults.push({
                profileId: profile.id,
                profileName: profile.name,
                sent: false,
                count: 0,
                ok: false,
                skipped: true,
                error: 'Bereits laufend'
            });
            continue;
        }

        runningByProfile.set(profile.id, true);
        try {
            profileResults.push(await runProfileOnce(appSettings, profile));
        } finally {
            runningByProfile.set(profile.id, false);
        }
    }

    return {
        sent: profileResults.some((entry) => entry.sent),
        count: profileResults.reduce((sum, entry) => sum + Number(entry.count || 0), 0),
        profileResults,
        successCount: profileResults.filter((entry) => entry.ok).length,
        failedCount: profileResults.filter((entry) => !entry.ok).length
    };
}

async function main() {
    const settingsPath = (process.env.SETTINGS_FILE_PATH || '').trim() || path.resolve(process.cwd(), 'config/app-settings.json');
    let appSettings = await ensureAppSettings(settingsPath);
    const isOnce = process.argv.includes('--once');

    const runningByProfile = new Map();
    const cronTasksByProfile = new Map();

    if (isOnce) {
        const result = await runAllProfilesOnce(appSettings, runningByProfile);
        console.log(`[job] Einmallauf abgeschlossen. Erfolgreiche Profile: ${result.successCount}, Fehler: ${result.failedCount}, Gesamtanzahl: ${result.count}`);
        process.exit(result.failedCount > 0 ? 1 : 0);
    }

    const scheduleCrons = () => {
        for (const task of cronTasksByProfile.values()) {
            task.stop();
            task.destroy();
        }
        cronTasksByProfile.clear();

        let profiles;
        try {
            profiles = getProfiles(appSettings);
        } catch (error) {
            console.warn(`[cron] Noch nicht aktiv: ${error.message}`);
            return;
        }

        for (const profile of profiles) {
            const task = cron.schedule(
                profile.cronExpression,
                async () => {
                    if (runningByProfile.get(profile.id)) {
                        console.warn(`[cron] Profil ${profile.name} läuft bereits, Tick wird übersprungen.`);
                        return;
                    }

                    runningByProfile.set(profile.id, true);
                    try {
                        await runProfileOnce(appSettings, profile);
                    } finally {
                        runningByProfile.set(profile.id, false);
                    }
                },
                {
                    timezone: appSettings.cronTimezone
                }
            );
            cronTasksByProfile.set(profile.id, task);
        }

        console.log(`[cron] Aktiv. Profile: ${profiles.length}, TZ: ${appSettings.cronTimezone}`);
    };

    const uiEnabled = (process.env.UI_ENABLED || 'true').trim().toLowerCase() !== 'false';
    if (uiEnabled) {
        await startUiServer({
            onSettingsChanged: async (nextSettings) => {
                appSettings = nextSettings;
                scheduleCrons();
                console.log('[ui] Einstellungen gespeichert und Cron neu geplant.');
            },
            onRunNow: async () => {
                const result = await runAllProfilesOnce(appSettings, runningByProfile, {throwIfRunning: true});
                console.log('[ui] Manuell ausgelöster Einmallauf abgeschlossen.');
                return result;
            }
        });
    } else {
        console.log('[ui] Deaktiviert (UI_ENABLED=false).');
    }

    scheduleCrons();
}

if (require.main === module) {
    main().catch((error) => {
        console.error('[startup] Konfigurations- oder Startfehler:', error);
        process.exit(1);
    });
}
