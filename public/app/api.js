async function parseJsonResponse(response, fallbackMessage) {
    const data = await response.json();
    if (!response.ok) {
        throw new Error(data.error || fallbackMessage);
    }
    return data;
}

export async function loadSettings() {
    const response = await fetch('/api/settings');
    return parseJsonResponse(response, 'Einstellungen konnten nicht geladen werden.');
}

export async function saveSettings(payload) {
    const response = await fetch('/api/settings', {
        method: 'PUT',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload)
    });
    return parseJsonResponse(response, 'Speichern fehlgeschlagen.');
}

export async function runOnceNow() {
    const response = await fetch('/api/job/run-once', {
        method: 'POST'
    });
    return parseJsonResponse(response, 'Einmallauf fehlgeschlagen.');
}

