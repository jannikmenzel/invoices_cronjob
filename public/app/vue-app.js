import {computed, createApp, onMounted, onUnmounted, reactive, watch} from '../vendor/vue.esm-browser.prod.js';
import {getAuthStatus, loadSettings, runOnceNow as runOnceNowApi, saveSettings, setStoredPassword, clearStoredPassword, setupPassword} from './api.js';
import {
    createProfile,
    normalizeCsv,
    normalizeProfilesFromSettings,
    parseClock,
    parseCronExpression,
    parseIsoDate,
    toClock,
    toIsoDate,
    toProfilePayload
} from './model.js';

const CRON_PRESET_CUSTOM = 'custom';
const weekdayLabels = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const monthFormatter = new Intl.DateTimeFormat('de-DE', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
});

function parseCronUiFromExpression(rawExpression) {
    const parsed = parseCronExpression(rawExpression);
    const preset = parsed.preset || CRON_PRESET_CUSTOM;
    const usesSimplePreset = preset === 'daily' || preset === 'weekly' || preset === 'biweekly' || preset === 'monthly' || preset === 'quarterly';
    return {
        preset,
        time: usesSimplePreset ? toClock(parsed.hour, parsed.minute) : '06:00',
        weekday: String(preset === 'weekly' ? parsed.weekday : 1),
        monthday: String(Math.min(28, Math.max(1, Number(preset === 'monthly' || preset === 'quarterly' ? parsed.monthday : 1))))
    };
}

function buildCronExpressionFromUi(cronUi, fallbackExpression) {
    const preset = String(cronUi.preset || 'daily');
    if (preset === CRON_PRESET_CUSTOM) {
        return String(fallbackExpression || '').trim();
    }

    const clock = parseClock(cronUi.time);
    if (!clock) return String(fallbackExpression || '').trim();

    if (preset === 'daily') {
        return `${clock.minute} ${clock.hour} * * *`;
    }

    if (preset === 'weekly') {
        const weekday = Number(cronUi.weekday);
        const safeWeekday = Number.isInteger(weekday) ? ((weekday % 7) + 7) % 7 : 1;
        return `${clock.minute} ${clock.hour} * * ${safeWeekday}`;
    }

    if (preset === 'biweekly') {
        return `${clock.minute} ${clock.hour} */14 * *`;
    }

    const rawMonthday = Number(cronUi.monthday);
    const safeMonthday = Number.isInteger(rawMonthday)
        ? Math.min(28, Math.max(1, rawMonthday))
        : 1;

    if (preset === 'quarterly') {
        return `${clock.minute} ${clock.hour} ${safeMonthday} */3 *`;
    }

    return `${clock.minute} ${clock.hour} ${safeMonthday} * *`;
}

function autoPeriodHintFromCron(rawCronExpression) {
    const parsed = parseCronExpression(rawCronExpression);
    if (parsed.preset === 'weekly') return 'Automatischer Zeitraum: letzte 7 Tage (bis gestern).';
    if (parsed.preset === 'biweekly') return 'Automatischer Zeitraum: letzte 14 Tage (bis gestern).';
    if (parsed.preset === 'quarterly') return 'Automatischer Zeitraum: letztes Quartal.';
    if (parsed.preset === 'daily') return 'Automatischer Zeitraum: letzter Tag (gestern).';
    if (parsed.preset === 'monthly') return 'Automatischer Zeitraum: letzter Kalendermonat.';
    return 'Automatischer Zeitraum: letzter Kalendermonat.';
}

function getReferencePeriodLabel(profile) {
    const start = String(profile?.invoicePeriodStart || '').trim();
    const end = String(profile?.invoicePeriodEnd || '').trim();
    if (start && end) return `${start} bis ${end}`;

    const parsed = parseCronExpression(profile?.cronExpression || '');
    if (parsed.preset === 'weekly') return 'letzte 7 Tage';
    if (parsed.preset === 'biweekly') return 'letzte 14 Tage';
    if (parsed.preset === 'quarterly') return 'letztes Quartal';
    if (parsed.preset === 'daily') return 'letzter Tag';
    return 'letzter Kalendermonat';
}

function dayOffsetMondayFirst(year, month) {
    const weekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
    return (weekday + 6) % 7;
}

const App = {
    setup() {
        const today = new Date();
        const state = reactive({
            profiles: [],
            activeProfileId: null,
            calendarView: new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)),
            cronUi: {
                preset: 'daily',
                time: '06:00',
                weekday: '1',
                monthday: '1'
            },
            lastSavedPayloadSignature: '',
            statusMessage: '',
            statusIsError: false,
            needsSetup: false,
            needsLogin: false,
            loginPassword: '',
            setupPassword: '',
            setupPasswordConfirm: ''
        });

        const activeProfile = computed(() => state.profiles.find((profile) => profile.id === state.activeProfileId) || null);

        const collectSettingsPayload = () => ({
            profiles: state.profiles.map((profile) => toProfilePayload(profile))
        });

        const payloadSignature = computed(() => JSON.stringify(collectSettingsPayload()));
        const hasUnsavedChanges = computed(() => {
            if (!state.lastSavedPayloadSignature) return false;
            return payloadSignature.value !== state.lastSavedPayloadSignature;
        });

        const calendarMonthLabel = computed(() => monthFormatter.format(state.calendarView));

        const selectedStartDate = computed(() => parseIsoDate(activeProfile.value?.invoicePeriodStart || ''));
        const selectedEndDate = computed(() => parseIsoDate(activeProfile.value?.invoicePeriodEnd || ''));

        const periodInfo = computed(() => {
            const start = selectedStartDate.value;
            const end = selectedEndDate.value;
            if (!start && !end) {
                return `Kein manueller Zeitraum gesetzt. ${autoPeriodHintFromCron(activeProfile.value?.cronExpression)}`;
            }
            if (start && !end) {
                return `Start gewählt: ${toIsoDate(start)}. Wähle jetzt ein Enddatum.`;
            }
            return `Ausgewählter Zeitraum: ${toIsoDate(start)} bis ${toIsoDate(end)}.`;
        });

        const calendarCells = computed(() => {
            const year = state.calendarView.getUTCFullYear();
            const month = state.calendarView.getUTCMonth();
            const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
            const leading = dayOffsetMondayFirst(year, month);
            const start = selectedStartDate.value;
            const end = selectedEndDate.value;
            const cells = [];

            for (let i = 0; i < leading; i += 1) {
                cells.push({key: `placeholder-${i}`, placeholder: true});
            }

            for (let day = 1; day <= daysInMonth; day += 1) {
                const date = new Date(Date.UTC(year, month, day));
                const inRange = start && end && date >= start && date <= end;
                const isEdge = (date.getTime() === start?.getTime()) || (date.getTime() === end?.getTime());
                cells.push({
                    key: `day-${day}`,
                    placeholder: false,
                    label: String(day),
                    date,
                    inRange,
                    isEdge
                });
            }

            return cells;
        });

        const mailPreviewSubject = computed(() => {
            if (!activeProfile.value) return '(kein Profil gewählt)';
            return activeProfile.value.mailSubject || 'Zustellung der Eingangsrechnungen';
        });

        const mailPreviewBody = computed(() => {
            if (!activeProfile.value) return '';
            const intro = String(activeProfile.value.mailText || '').trim();
            const referencePeriodLabel = getReferencePeriodLabel(activeProfile.value);
            const docsBlock = [
                `Die PDF beinhaltet folgende Dokumente für den Zeitraum ${referencePeriodLabel}:`,
                '1. [1001] Rechnung Januar',
                '2. [1002] Rechnung Februar',
                '',
                'Hinweis: Diese E-Mail wurde automatisch erstellt und versendet.'
            ].join('\n');
            return intro ? `${intro}\n\n${docsBlock}` : docsBlock;
        });

        const cronIsCustom = computed(() => state.cronUi.preset === CRON_PRESET_CUSTOM);

        function setStatus(message, isError = false) {
            state.statusMessage = message;
            state.statusIsError = isError;
        }

        function applyCronUiFromActiveProfile() {
            if (!activeProfile.value) return;
            const parsed = parseCronUiFromExpression(activeProfile.value.cronExpression);
            state.cronUi.preset = parsed.preset;
            state.cronUi.time = parsed.time;
            state.cronUi.weekday = parsed.weekday;
            state.cronUi.monthday = parsed.monthday;
            if (parsed.preset !== CRON_PRESET_CUSTOM) {
                activeProfile.value.cronExpression = buildCronExpressionFromUi(state.cronUi, activeProfile.value.cronExpression);
            }
        }

        function syncCronExpressionFromUi() {
            if (!activeProfile.value) return;
            if (state.cronUi.preset !== CRON_PRESET_CUSTOM) {
                activeProfile.value.cronExpression = buildCronExpressionFromUi(state.cronUi, activeProfile.value.cronExpression);
            }
            if (state.cronUi.preset === 'monthly' || state.cronUi.preset === 'quarterly') {
                const safeMonthday = Math.min(28, Math.max(1, Number(state.cronUi.monthday) || 1));
                state.cronUi.monthday = String(safeMonthday);
            }
        }

        function normalizeActiveProfileFields() {
            if (!activeProfile.value) return;
            activeProfile.value.name = String(activeProfile.value.name || '').trim();
            activeProfile.value.objectNumbers = normalizeCsv(activeProfile.value.objectNumbers);
            activeProfile.value.mailTo = normalizeCsv(activeProfile.value.mailTo);
            activeProfile.value.mailSubject = String(activeProfile.value.mailSubject || '').trim();
            activeProfile.value.mailText = String(activeProfile.value.mailText || '').trim();
            activeProfile.value.invoicePeriodStart = String(activeProfile.value.invoicePeriodStart || '').trim();
            activeProfile.value.invoicePeriodEnd = String(activeProfile.value.invoicePeriodEnd || '').trim();
            activeProfile.value.cronExpression = String(activeProfile.value.cronExpression || '').trim();
        }

        function setCalendarMonthFromSelection() {
            const start = parseIsoDate(activeProfile.value?.invoicePeriodStart || '');
            const source = start || new Date();
            state.calendarView = new Date(Date.UTC(source.getUTCFullYear(), source.getUTCMonth(), 1));
        }

        function selectCalendarDate(date) {
            if (!activeProfile.value) return;
            const selectedStart = parseIsoDate(activeProfile.value.invoicePeriodStart);
            const selectedEnd = parseIsoDate(activeProfile.value.invoicePeriodEnd);

            if (!selectedStart || (selectedStart && selectedEnd)) {
                activeProfile.value.invoicePeriodStart = toIsoDate(date);
                activeProfile.value.invoicePeriodEnd = '';
                return;
            }

            if (date < selectedStart) {
                activeProfile.value.invoicePeriodStart = toIsoDate(date);
                activeProfile.value.invoicePeriodEnd = toIsoDate(selectedStart);
            } else {
                activeProfile.value.invoicePeriodEnd = toIsoDate(date);
            }
        }

        function addProfile() {
            normalizeActiveProfileFields();
            const profile = createProfile({cronExpression: activeProfile.value?.cronExpression || '0 6 1 * *'}, state.profiles.length + 1);
            state.profiles.push(profile);
            state.activeProfileId = profile.id;
            setCalendarMonthFromSelection();
            applyCronUiFromActiveProfile();
        }

        function removeActiveProfile() {
            if (state.profiles.length <= 1) {
                setStatus('Mindestens ein Profil muss vorhanden sein.', true);
                return;
            }
            state.profiles = state.profiles.filter((profile) => profile.id !== state.activeProfileId);
            state.activeProfileId = state.profiles[0]?.id || null;
            setCalendarMonthFromSelection();
            applyCronUiFromActiveProfile();
            setStatus('Profil entfernt.');
        }

        function selectProfile(profileId) {
            normalizeActiveProfileFields();
            state.activeProfileId = profileId;
            setCalendarMonthFromSelection();
            applyCronUiFromActiveProfile();
        }

        function clearPeriod() {
            if (!activeProfile.value) return;
            activeProfile.value.invoicePeriodStart = '';
            activeProfile.value.invoicePeriodEnd = '';
        }

        function prevMonth() {
            state.calendarView = new Date(Date.UTC(state.calendarView.getUTCFullYear(), state.calendarView.getUTCMonth() - 1, 1));
        }

        function nextMonth() {
            state.calendarView = new Date(Date.UTC(state.calendarView.getUTCFullYear(), state.calendarView.getUTCMonth() + 1, 1));
        }

        async function loadSettingsFromServer() {
            const data = await loadSettings();
            state.profiles = normalizeProfilesFromSettings(data.settings || {});
            state.activeProfileId = state.profiles[0]?.id || null;
            applyCronUiFromActiveProfile();
            setCalendarMonthFromSelection();
            state.lastSavedPayloadSignature = JSON.stringify(collectSettingsPayload());
        }

        async function saveSettingsToServer() {
            normalizeActiveProfileFields();
            setStatus('Speichere...');
            const data = await saveSettings(collectSettingsPayload());
            state.profiles = normalizeProfilesFromSettings(data.settings || {});
            const hasCurrent = state.profiles.some((profile) => profile.id === state.activeProfileId);
            state.activeProfileId = hasCurrent ? state.activeProfileId : (state.profiles[0]?.id || null);
            applyCronUiFromActiveProfile();
            setCalendarMonthFromSelection();
            state.lastSavedPayloadSignature = JSON.stringify(collectSettingsPayload());
            setStatus('Gespeichert.');
        }

        async function reloadSettings() {
            try {
                await loadSettingsFromServer();
                setStatus('Neu geladen.');
            } catch (error) {
                if (error.message.includes('Unauthorized') || error.message.includes('401')) {
                    state.needsLogin = true;
                } else {
                    setStatus(error.message, true);
                }
            }
        }

        async function runOnceNow() {
            setStatus('Starte Einmallauf...');
            try {
                const data = await runOnceNowApi();
                const count = Number(data?.result?.count || 0);
                const successCount = Number(data?.result?.successCount || 0);
                const failedCount = Number(data?.result?.failedCount || 0);
                setStatus(
                    `Einmallauf abgeschlossen. Erfolgreich: ${successCount}, Fehler: ${failedCount}, Gesamtanzahl: ${count}.`,
                    failedCount > 0
                );
            } catch (error) {
                setStatus(error.message, true);
            }
        }

        async function onSubmit(event) {
            event.preventDefault();
            try {
                await saveSettingsToServer();
            } catch (error) {
                setStatus(error.message, true);
            }
        }

        function onCronExpressionInput() {
            if (!activeProfile.value) return;
            activeProfile.value.cronExpression = String(activeProfile.value.cronExpression || '').trim();
            const parsed = parseCronUiFromExpression(activeProfile.value.cronExpression);
            state.cronUi.preset = parsed.preset;
            state.cronUi.time = parsed.time;
            state.cronUi.weekday = parsed.weekday;
            state.cronUi.monthday = parsed.monthday;
        }

        watch(
            () => [state.cronUi.preset, state.cronUi.time, state.cronUi.weekday, state.cronUi.monthday],
            () => {
                syncCronExpressionFromUi();
            }
        );

        const beforeUnloadHandler = (event) => {
            if (!hasUnsavedChanges.value) return;
            event.preventDefault();
        };

        onMounted(() => {
            window.addEventListener('beforeunload', beforeUnloadHandler);
            checkAuthAndLoad();
        });

        async function checkAuthAndLoad() {
            try {
                const auth = await getAuthStatus();
                if (!auth.isPasswordSet) {
                    state.needsSetup = true;
                    return;
                }
            } catch (error) {
                setStatus(error.message, true);
                return;
            }
            state.needsLogin = true;
        }

        async function submitSetup() {
            if (state.setupPassword.length < 4) {
                setStatus('Passwort muss mindestens 4 Zeichen lang sein.', true);
                return;
            }
            if (state.setupPassword !== state.setupPasswordConfirm) {
                setStatus('Passwörter stimmen nicht überein.', true);
                return;
            }
            try {
                await setupPassword(state.setupPassword);
                setStoredPassword(state.setupPassword);
                state.needsSetup = false;
                state.loginPassword = state.setupPassword;
                state.setupPassword = '';
                state.setupPasswordConfirm = '';
                setStatus('Passwort gesetzt.');
                loadSettingsFromServer().catch((error) => {
                    clearStoredPassword();
                    state.needsLogin = true;
                    setStatus(error.message, true);
                });
            } catch (error) {
                setStatus(error.message, true);
            }
        }

        function logout() {
            state.loginPassword = '';
            clearStoredPassword();
            state.needsLogin = true;
        }

        function submitLogin() {
            if (!state.loginPassword) {
                setStatus('Bitte Passwort eingeben.', true);
                return;
            }
            setStoredPassword(state.loginPassword);
            state.needsLogin = false;
            loadSettingsFromServer().catch((error) => {
                clearStoredPassword();
                if (error.message.includes('Unauthorized') || error.message.includes('401')) {
                    state.needsLogin = true;
                    setStatus('Ungültiges Passwort.', true);
                } else {
                    setStatus(error.message, true);
                }
            });
        }

        onUnmounted(() => {
            window.removeEventListener('beforeunload', beforeUnloadHandler);
        });

        return {
            activeProfile,
            calendarCells,
            calendarMonthLabel,
            clearPeriod,
            cronIsCustom,
            hasUnsavedChanges,
            mailPreviewBody,
            mailPreviewSubject,
            nextMonth,
            onCronExpressionInput,
            onSubmit,
            periodInfo,
            prevMonth,
            reloadSettings,
            removeActiveProfile,
            runOnceNow,
            selectCalendarDate,
            selectProfile,
            state,
            weekdayLabels,
            addProfile,
            submitSetup,
            submitLogin,
            logout
        };
    },
    template: `
        <main class="container py-4">
            <div class="row justify-content-center">
                <div class="col-12 col-xl-10">
                    <div v-if="state.needsSetup" class="card shadow-sm">
                        <div class="card-body p-4 p-md-5">
                            <div class="mb-4">
                                <h1 class="h3 mb-2">Willkommen</h1>
                                <p class="text-secondary mb-0">Bitte richten Sie ein Passwort ein, um die Anwendung zu schützen.</p>
                            </div>
                            <form @submit.prevent="submitSetup">
                                <div class="mb-3">
                                    <label class="form-label" for="setupPassword">Passwort</label>
                                    <input type="password" class="form-control" id="setupPassword" v-model="state.setupPassword" required minlength="4" />
                                    <div class="form-text">Mindestens 4 Zeichen.</div>
                                </div>
                                <div class="mb-3">
                                    <label class="form-label" for="setupPasswordConfirm">Passwort bestätigen</label>
                                    <input type="password" class="form-control" id="setupPasswordConfirm" v-model="state.setupPasswordConfirm" required />
                                </div>
                                <button type="submit" class="btn btn-primary">Passwort setzen</button>
                            </form>
                            <p class="status alert mt-4 mb-0" :class="state.statusIsError ? 'alert-danger' : 'alert-success'" role="alert">{{ state.statusMessage }}</p>
                        </div>
                    </div>

                    <div v-else-if="state.needsLogin" class="card shadow-sm">
                        <div class="card-body p-4 p-md-5">
                            <div class="mb-4">
                                <h1 class="h3 mb-2">Anmeldung</h1>
                                <p class="text-secondary mb-0">Bitte geben Sie Ihr Passwort ein.</p>
                            </div>
                            <form @submit.prevent="submitLogin">
                                <div class="mb-3">
                                    <label class="form-label" for="loginPassword">Passwort</label>
                                    <input type="password" class="form-control" id="loginPassword" v-model="state.loginPassword" required />
                                </div>
                                <button type="submit" class="btn btn-primary">Anmelden</button>
                            </form>
                            <p class="status alert mt-4 mb-0" :class="state.statusIsError ? 'alert-danger' : 'alert-success'" role="alert">{{ state.statusMessage }}</p>
                        </div>
                    </div>

                    <div v-else class="card shadow-sm">
                        <div class="card-body p-4 p-md-5">
                            <div class="mb-4">
                                <div class="d-flex justify-content-between align-items-start flex-wrap gap-3">
                                    <div>
                                        <h1 class="h3 mb-2">Rechnungsversand Konfiguration</h1>
                                        <p class="text-secondary mb-0">Übersicht aller automatisierten Versandprozesse</p>
                                    </div>
                                    <button class="btn btn-outline-secondary btn-sm" type="button" @click="logout">Abmelden</button>
                                </div>
                            </div>

                            <form class="row g-4" @submit="onSubmit">
                                <div class="col-12">
                                    <div class="card border-0 bg-light-subtle">
                                        <div class="card-body" v-if="activeProfile">
                                            <div class="d-flex align-items-center justify-content-between gap-3 mb-3 flex-wrap">
                                                <h2 class="h5 mb-0">Eigentümer-Profile</h2>
                                                <fieldset class="mb-0 border-0 p-0">
                                                    <legend class="visually-hidden">Profilaktionen</legend>
                                                    <div class="d-flex gap-2 flex-wrap">
                                                        <button class="btn btn-outline-primary btn-sm" type="button" @click="addProfile">Profil anlegen</button>
                                                        <button class="btn btn-danger btn-sm" type="button" :disabled="state.profiles.length <= 1" @click="removeActiveProfile">Aktives Profil löschen</button>
                                                    </div>
                                                </fieldset>
                                            </div>

                                            <div class="profile-list mb-3">
                                                <button
                                                    v-for="profile in state.profiles"
                                                    :key="profile.id"
                                                    type="button"
                                                    class="profile-pill btn btn-sm"
                                                    :class="profile.id === state.activeProfileId ? 'btn-primary' : 'btn-outline-primary'"
                                                    @click="selectProfile(profile.id)">
                                                    {{ profile.name || 'Unbenannt' }}
                                                </button>
                                            </div>

                                            <div class="row g-3">
                                                <div class="col-12">
                                                    <label class="form-label" for="profileName">Name</label>
                                                    <input class="form-control" id="profileName" v-model="activeProfile.name" placeholder="Eigentümer Mustermann" />
                                                </div>

                                                <div class="col-12 col-lg-6">
                                                    <label class="form-label" for="objectNumbers">Objektnummer(n)</label>
                                                    <input class="form-control" id="objectNumbers" v-model="activeProfile.objectNumbers" placeholder="101,102" />
                                                </div>

                                                <div class="col-12 col-lg-6">
                                                    <label class="form-label">Dokumententyp(en)</label>
                                                    <div>
                                                        <div class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="doc-eingangsrechnung" value="Eingangsrechnung" v-model="activeProfile.documents">
                                                            <label class="form-check-label" for="doc-eingangsrechnung">Eingangsrechnung</label>
                                                        </div>
                                                        <div class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="doc-kontoauszug" value="Kontoauszug" v-model="activeProfile.documents">
                                                            <label class="form-check-label" for="doc-kontoauszug">Kontoauszug</label>
                                                        </div>
                                                        <div class="form-check">
                                                            <input class="form-check-input" type="checkbox" id="doc-abrechnung" value="Abrechnung/Wirtschaftsplan/EÜ-Abr." v-model="activeProfile.documents">
                                                            <label class="form-check-label" for="doc-abrechnung">Abrechnung/Wirtschaftsplan/EÜ-Abr.</label>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div class="col-12 col-lg-6">
                                                    <label class="form-label" for="mailTo">Adressat(en)</label>
                                                    <input class="form-control" id="mailTo" v-model="activeProfile.mailTo" placeholder="max@example.com,anna@example.com" />
                                                </div>

                                                <div class="col-12">
                                                    <label class="form-label" for="mailSubject">E-Mail Betreff</label>
                                                    <input class="form-control" id="mailSubject" v-model="activeProfile.mailSubject" placeholder="Zustellung der Eingangsrechnungen" />
                                                </div>

                                                <div class="col-12">
                                                    <label class="form-label" for="mailText">E-Mail Einleitung</label>
                                                    <textarea class="form-control" id="mailText" v-model="activeProfile.mailText" rows="5"></textarea>
                                                    <p class="form-text mb-0">Der Zeitraum und die Dokumentliste werden automatisch am Ende ergänzt.</p>
                                                </div>

                                                <div class="col-12">
                                                    <h3 class="h6 mb-2">Mail-Vorschau</h3>
                                                    <div class="card bg-light border-0">
                                                        <div class="card-body p-3">
                                                            <div class="mb-2" style="font-family: monospace; white-space: pre-wrap; word-break: break-all; font-size: 0.9rem;">{{ mailPreviewSubject }}</div>
                                                            <hr class="my-2">
                                                            <div style="font-family: monospace; white-space: pre-wrap; word-break: break-all; max-height: 250px; overflow-y: auto; font-size: 0.9rem;">{{ mailPreviewBody }}</div>
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div class="col-12" v-if="activeProfile">
                                    <div class="card border-0 bg-light-subtle">
                                        <div class="card-body">
                                            <div class="d-flex align-items-center justify-content-between gap-3 mb-3 flex-wrap">
                                                <h2 class="h5 mb-0">Zeitraum Auswahl</h2>
                                                <button class="btn btn-outline-secondary btn-sm" type="button" @click="clearPeriod">Zeitraum leeren</button>
                                            </div>

                                            <div class="period-picker">
                                                <div class="calendar-toolbar">
                                                    <button aria-label="Vorheriger Monat" class="btn btn-outline-primary btn-sm" type="button" @click="prevMonth">&#8249;</button>
                                                    <strong>{{ calendarMonthLabel }}</strong>
                                                    <button aria-label="Nächster Monat" class="btn btn-outline-primary btn-sm" type="button" @click="nextMonth">&#8250;</button>
                                                </div>
                                                <div class="calendar-grid calendar-weekdays text-center mb-2">
                                                    <span>Mo</span><span>Di</span><span>Mi</span><span>Do</span><span>Fr</span><span>Sa</span><span>So</span>
                                                </div>
                                                <div class="calendar-grid">
                                                    <button
                                                        v-for="cell in calendarCells"
                                                        :key="cell.key"
                                                        type="button"
                                                        class="calendar-day btn btn-outline-secondary btn-sm"
                                                        :class="{ placeholder: cell.placeholder, 'in-range': cell.inRange, 'range-edge': cell.isEdge, 'border-0 bg-transparent': cell.placeholder }"
                                                        :disabled="cell.placeholder"
                                                        @click="selectCalendarDate(cell.date)">
                                                        {{ cell.label || '' }}
                                                    </button>
                                                </div>
                                                <p class="hint mt-3 mb-0">{{ periodInfo }}</p>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div class="col-12" v-if="activeProfile">
                                    <div class="card border-0 bg-light-subtle">
                                        <div class="card-body">
                                            <h2 class="h5 mb-3">Zeitplan (einfach)</h2>
                                            <div class="row g-3">
                                                <div class="col-12 col-lg-4">
                                                    <label class="form-label" for="cronPreset">Rhythmus</label>
                                                    <select class="form-select" id="cronPreset" v-model="state.cronUi.preset">
                                                        <option value="daily">Täglich</option>
                                                        <option value="weekly">Wöchentlich</option>
                                                        <option value="biweekly">Alle 2 Wochen</option>
                                                        <option value="monthly">Monatlich</option>
                                                        <option value="quarterly">Vierteljährlich</option>
                                                        <option value="custom">Erweitert (manuell)</option>
                                                    </select>
                                                </div>
                                                <div class="col-12 col-lg-4">
                                                    <label class="form-label" for="cronTime">Uhrzeit</label>
                                                    <input class="form-control" id="cronTime" type="time" v-model="state.cronUi.time" :disabled="cronIsCustom" />
                                                </div>
                                                <div class="col-12 col-lg-4">
                                                    <label class="form-label" for="cronWeekday">Wochentag</label>
                                                    <select class="form-select" id="cronWeekday" v-model="state.cronUi.weekday" :disabled="cronIsCustom || state.cronUi.preset !== 'weekly'">
                                                        <option v-for="(label, day) in weekdayLabels" :key="label" :value="String(day)">{{ label }}</option>
                                                    </select>
                                                </div>
                                                <div class="col-12 col-lg-4">
                                                    <label class="form-label" for="cronMonthday">Tag im Monat</label>
                                                    <input class="form-control" id="cronMonthday" type="number" min="1" max="28" v-model="state.cronUi.monthday" :disabled="cronIsCustom || (state.cronUi.preset !== 'monthly' && state.cronUi.preset !== 'quarterly')" />
                                                </div>
                                                <div class="col-12 col-lg-8">
                                                    <label class="form-label" for="cronExpression">Cron Expression (erweitert)</label>
                                                    <input class="form-control" id="cronExpression" v-model="activeProfile.cronExpression" :readonly="!cronIsCustom" @input="onCronExpressionInput" required />
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                <div class="col-12">
                                    <div class="d-flex flex-wrap justify-content-between">
                                        <div class="d-flex gap-2 flex-wrap">
                                            <button class="btn btn-success" type="submit">Speichern</button>
                                            <button class="btn btn-outline-secondary" type="button" @click="reloadSettings">Neu laden</button>
                                        </div>
                                        <button class="btn btn-outline-primary" type="button" @click="runOnceNow">Jetzt einmal ausführen</button>
                                    </div>
                                    <p class="mt-2 mb-0">{{ hasUnsavedChanges ? 'Ungespeicherte Änderungen' : '' }}</p>
                                </div>
                            </form>
                            <p
                                class="status alert mt-4 mb-0"
                                :class="state.statusIsError ? 'alert-danger' : 'alert-success'"
                                role="alert">
                                {{ state.statusMessage }}
                            </p>
                        </div>
                    </div>
                </div>
            </div>
        </main>
    `
};

export function VueApp() {
    createApp(App).mount('#app');
}

