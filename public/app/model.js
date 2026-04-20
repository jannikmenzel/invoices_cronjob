const CRON_PRESET_CUSTOM = 'custom';

export function toIsoDate(date) {
    const year = String(date.getUTCFullYear());
    const month = String(date.getUTCMonth() + 1).padStart(2, '0');
    const day = String(date.getUTCDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function parseIsoDate(value) {
    const raw = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
    const [year, month, day] = raw.split('-').map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day
    ) {
        return null;
    }
    return date;
}

export function normalizeCsv(value) {
    return String(value || '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .join(',');
}

export function createProfile(base = {}, index = 1) {
    const id = base.id || `profil-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    return {
        id,
        name: String(base.name || '').trim() || `Eigentümer ${index}`,
        objectNumbers: normalizeCsv(base.objectNumbers),
        mailTo: normalizeCsv(base.mailTo),
        mailSubject: String(base.mailSubject || '').trim(),
        mailText: String(base.mailText || '').trim(),
        invoicePeriodStart: String(base.invoicePeriodStart || '').trim(),
        invoicePeriodEnd: String(base.invoicePeriodEnd || '').trim(),
        cronExpression: String(base.cronExpression || '0 6 1 * *').trim()
    };
}

export function parseClock(value) {
    const raw = String(value || '').trim();
    const match = new RegExp(/^(\d{2}):(\d{2})$/).exec(raw);
    if (!match) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    return {hour, minute};
}

export function toClock(hour, minute) {
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function parseCronExpression(rawExpression) {
    const raw = String(rawExpression || '').trim();
    const daily = new RegExp(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+\*$/).exec(raw);
    if (daily) {
        const minute = Number(daily[1]);
        const hour = Number(daily[2]);
        if (minute <= 59 && hour <= 23) {
            return {preset: 'daily', hour, minute};
        }
    }
    const weekly = new RegExp(/^(\d{1,2})\s+(\d{1,2})\s+\*\s+\*\s+([0-7])$/).exec(raw);
    if (weekly) {
        const minute = Number(weekly[1]);
        const hour = Number(weekly[2]);
        const weekday = Number(weekly[3]) % 7;
        if (minute <= 59 && hour <= 23) {
            return {preset: 'weekly', hour, minute, weekday};
        }
    }
    const biweekly = new RegExp(/^(\d{1,2})\s+(\d{1,2})\s+\*\/14\s+\*\s+\*$/).exec(raw);
    if (biweekly) {
        const minute = Number(biweekly[1]);
        const hour = Number(biweekly[2]);
        if (minute <= 59 && hour <= 23) {
            return {preset: 'biweekly', hour, minute};
        }
    }
    const quarterly = new RegExp(/^(\d{1,2})\s+(\d{1,2})\s+([1-9]|[12]\d|3[01])\s+(\*\/3|1,4,7,10)\s+\*$/).exec(raw);
    if (quarterly) {
        const minute = Number(quarterly[1]);
        const hour = Number(quarterly[2]);
        const monthday = Number(quarterly[3]);
        if (minute <= 59 && hour <= 23) {
            return {preset: 'quarterly', hour, minute, monthday};
        }
    }
    const monthly = new RegExp(/^(\d{1,2})\s+(\d{1,2})\s+([1-9]|[12]\d|3[01])\s+\*\s+\*$/).exec(raw);
    if (monthly) {
        const minute = Number(monthly[1]);
        const hour = Number(monthly[2]);
        const monthday = Number(monthly[3]);
        if (minute <= 59 && hour <= 23) {
            return {preset: 'monthly', hour, minute, monthday};
        }
    }
    return {preset: CRON_PRESET_CUSTOM};
}

export function normalizeProfilesFromSettings(settings) {
    if (Array.isArray(settings.profiles) && settings.profiles.length > 0) {
        return settings.profiles.map((profile, index) => createProfile(profile, index + 1));
    }
    if (settings.objectNumbers || settings.mailTo) {
        return [createProfile({
            id: 'standard-1',
            name: 'Standard',
            objectNumbers: settings.objectNumbers,
            mailTo: settings.mailTo,
            mailSubject: settings.mailSubject,
            mailText: settings.mailText,
            invoicePeriodStart: settings.invoicePeriodStart,
            invoicePeriodEnd: settings.invoicePeriodEnd,
            cronExpression: settings.cronExpression
        }, 1)];
    }
    return [createProfile({id: 'standard-1', name: 'Standard'}, 1)];
}

export function toProfilePayload(profile) {
    return {
        id: profile.id,
        name: String(profile.name || '').trim(),
        objectNumbers: normalizeCsv(profile.objectNumbers),
        mailTo: normalizeCsv(profile.mailTo),
        mailSubject: String(profile.mailSubject || '').trim(),
        mailText: String(profile.mailText || '').trim(),
        invoicePeriodStart: String(profile.invoicePeriodStart || '').trim(),
        invoicePeriodEnd: String(profile.invoicePeriodEnd || '').trim(),
        cronExpression: String(profile.cronExpression || '').trim()
    };
}
