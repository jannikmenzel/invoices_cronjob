let storedPassword = '';

export function setStoredPassword(password) {
    storedPassword = password;
}

export function clearStoredPassword() {
    storedPassword = '';
}

function authHeader() {
    if (!storedPassword) return {};
    const credentials = ':' + storedPassword;
    const base64 = btoa(credentials);
    return {'Authorization': `Basic ${base64}`};
}

async function parseJsonResponse(response, fallbackMessage) {
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.error || fallbackMessage);
    }
    return data;
}

export async function getAuthStatus() {
    const response = await fetch('/api/auth/status');
    return parseJsonResponse(response, 'Auth-Status konnte nicht abgerufen werden.');
}

export async function setupPassword(password) {
    const response = await fetch('/api/auth/setup', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({password})
    });
    return parseJsonResponse(response, 'Passwort konnte nicht gesetzt werden.');
}

export async function loadSettings() {
    const response = await fetch('/api/settings', {headers: {...authHeader()}});
    return parseJsonResponse(response, 'Einstellungen konnten nicht geladen werden.');
}

export async function saveSettings(payload) {
    const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: {'Content-Type': 'application/json', ...authHeader()},
        body: JSON.stringify(payload)
    });
    return parseJsonResponse(response, 'Speichern fehlgeschlagen.');
}

export async function runOnceNow() {
    const response = await fetch('/api/job/run-once', {
        method: 'POST',
        headers: authHeader()
    });
    return parseJsonResponse(response, 'Einmallauf fehlgeschlagen.');
}

