const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const {readAppSettings, writeAppSettings} = require('../../settings/app-settings');

function json(res, statusCode, payload) {
    res.writeHead(statusCode, {'Content-Type': 'application/json; charset=utf-8'});
    res.end(JSON.stringify(payload));
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

            if (url.pathname === '/api/settings' && req.method === 'GET') {
                const settings = await readAppSettings(settingsPath);
                return json(res, 200, {settings});
            }

            if (url.pathname === '/api/settings' && req.method === 'PUT') {
                const body = await readRequestBody(req);
                const parsed = JSON.parse(body || '{}');
                const settings = await writeAppSettings(settingsPath, parsed);
                if (typeof onSettingsChanged === 'function') {
                    await onSettingsChanged(settings);
                }
                return json(res, 200, {ok: true, settings});
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

