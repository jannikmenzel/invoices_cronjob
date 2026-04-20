require('dotenv/config');
const path = require('node:path');
const {createUiServer} = require('./server');
const {ensureAppSettings} = require('../../settings/app-settings');

async function startUiServer(options = {}) {
    const settingsPath = (process.env.SETTINGS_FILE_PATH || '').trim() || path.resolve(process.cwd(), 'config/app-settings.json');
    const publicDir = path.resolve(process.cwd(), 'public');
    const port = Number(process.env.UI_PORT || 3030);
    const host = (process.env.UI_HOST || '').trim() || '127.0.0.1';
    await ensureAppSettings(settingsPath);

    const server = createUiServer({
        settingsPath,
        publicDir,
        onSettingsChanged: options.onSettingsChanged,
        onRunNow: options.onRunNow
    });

    await new Promise((resolve) => {
        server.listen(port, host, () => {
            console.log(`[ui] Aktiv unter http://${host}:${port}`);
            console.log(`[ui] Bearbeitet Datei: ${settingsPath}`);
            resolve();
        });
    });

    return server;
}

async function main() {
    await startUiServer();
}

if (require.main === module) {
    main().catch((error) => {
        console.error('[ui] Startfehler:', error);
        process.exit(1);
    });
}

module.exports = {
    startUiServer
};

