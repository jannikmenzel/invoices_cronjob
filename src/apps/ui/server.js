const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const {readAppSettings, writeAppSettings, hashPassword, verifyPassword} = require('../../settings/app-settings');

function json(res, statusCode, payload) {
    res.writeHead(statusCode, {'Content-Type': 'application/json; charset=utf-8'});
    res.end(JSON.stringify(payload));
}

function parseBasicAuth(req) {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Basic ')) {
        return null;
    }
    const base64 = authHeader.slice(6);
    const decoded = Buffer.from(base64, 'base64').toString('utf8');
    const colonIndex = decoded.indexOf(':');
    if (colonIndex === -1) {
        return null;
    }
    return {
        username: decoded.slice(0, colonIndex),
        password: decoded.slice(colonIndex + 1)
    };
}

function requireAuth(req, res, settings) {
    const authConfig = settings?.auth || {};

    if (!authConfig.isPasswordSet) {
        res.writeHead(401, {
            'Content-Type': 'application/json; charset=utf-8',
            'WWW-Authenticate': 'Basic realm="Invoices Cronjob"'
        });
        res.end(JSON.stringify({error: 'Passwort erforderlich. Bitte zuerst ein Passwort setzen.'}));
        return {authenticated: false, needsSetup: true};
    }

    const auth = parseBasicAuth(req);
    if (!auth?.password || !verifyPassword(auth.password, authConfig.passwordHash)) {
        res.writeHead(401, {
            'Content-Type': 'application/json; charset=utf-8',
            'WWW-Authenticate': 'Basic realm="Invoices Cronjob"'
        });
        res.end(JSON.stringify({error: 'Unauthorized'}));
        return {authenticated: false, needsSetup: false};
    }
    return {authenticated: true, needsSetup: false};
}

async function readRequestBody(req) {
    const chunks = [];
    for await (const chunk of req) {
        chunks.push(chunk);
    }
    return Buffer.concat(chunks).toString('utf8');
}

function contentType(filePath) {
    if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
    if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
    if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
    if (filePath.endsWith('.ico')) return 'image/x-icon';
    return 'text/plain; charset=utf-8';
}

function createUiServer({settingsPath, publicDir, onSettingsChanged, onRunNow}) {
    return http.createServer(async (req, res) => {
        try {
            const url = new URL(req.url || '/', 'http://localhost');

            if (url.pathname.startsWith('/api/')) {
                const settings = await readAppSettings(settingsPath, {allowIncomplete: true});
                const isSetupRequest = url.pathname === '/api/auth/setup' && req.method === 'POST';
                const isStatusRequest = url.pathname === '/api/auth/status' && req.method === 'GET';

                if (!isSetupRequest && !isStatusRequest) {
                    const authResult = requireAuth(req, res, settings);
                    if (!authResult.authenticated) {
                        return;
                    }
                }

                if (url.pathname === '/api/auth/status' && req.method === 'GET') {
                    return json(res, 200, {isPasswordSet: settings?.auth?.isPasswordSet || false});
                }

                if (url.pathname === '/api/auth/setup' && req.method === 'POST') {
                    if (settings?.auth?.isPasswordSet) {
                        return json(res, 400, {error: 'Passwort bereits gesetzt.'});
                    }
                    const body = await readRequestBody(req);
                    const parsed = JSON.parse(body || '{}');
                    const password = parsed.password;
                    if (!password || typeof password !== 'string' || password.length < 4) {
                        return json(res, 400, {error: 'Passwort muss mindestens 4 Zeichen lang sein.'});
                    }
                    const newSettings = await writeAppSettings(settingsPath, {
                        ...settings,
                        auth: {
                            isPasswordSet: true,
                            passwordHash: hashPassword(password)
                        }
                    });
                    if (typeof onSettingsChanged === 'function') {
                        await onSettingsChanged(newSettings);
                    }
                    return json(res, 200, {ok: true});
                }
            }

            if (url.pathname === '/api/settings' && req.method === 'GET') {
                const settings = await readAppSettings(settingsPath, {allowIncomplete: true});
                const safeSettings = {...settings};
                if (safeSettings.auth) {
                    safeSettings.auth = {...safeSettings.auth, passwordHash: '[hidden]'};
                }
                return json(res, 200, {settings: safeSettings});
            }

            if (url.pathname === '/api/settings' && req.method === 'PUT') {
                const settings = await readAppSettings(settingsPath, {allowIncomplete: true});
                const body = await readRequestBody(req);
                const parsed = JSON.parse(body || '{}');
                const newSettings = await writeAppSettings(settingsPath, {
                    ...settings,
                    ...parsed
                });
                if (typeof onSettingsChanged === 'function') {
                    await onSettingsChanged(newSettings);
                }
                return json(res, 200, {ok: true, settings: newSettings});
            }

            if (url.pathname === '/api/job/run-once' && req.method === 'POST') {
                if (typeof onRunNow !== 'function') {
                    return json(res, 501, {error: 'Run-once ist in diesem Modus nicht verfügbar.'});
                }
                const result = await onRunNow();
                return json(res, 200, {ok: true, result});
            }

            if (req.method !== 'GET' && req.method !== 'HEAD') {
                return json(res, 405, {error: 'Method not allowed'});
            }

            const requested = url.pathname === '/' ? '/index.html' : url.pathname;
            const normalized = path.normalize(requested).replace(/^\/+/, '');
            const root = path.resolve(publicDir);
            const filePath = path.resolve(root, normalized);

            if (!filePath.startsWith(root)) {
                return json(res, 403, {error: 'Forbidden'});
            }

            const file = await fs.readFile(filePath);
            res.writeHead(200, {'Content-Type': contentType(filePath)});
            if (req.method === 'HEAD') {
                return res.end();
            }
            res.end(file);
        } catch (error) {
            if (error.code === 'ENOENT') {
                return json(res, 404, {error: 'Not found'});
            }
            if (error instanceof SyntaxError) {
                return json(res, 400, {error: 'Ungültiges JSON im Request-Body.'});
            }
            return json(res, 400, {error: error.message || 'Unbekannter Fehler'});
        }
    });
}

module.exports = {
    createUiServer
};

