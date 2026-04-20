# Docker-Setup für `invoices_cronjob`

Dieses Projekt läuft in Docker am einfachsten als **ein Container**, der bereits **Cron-Job und Web-UI gemeinsam** startet.

## Was im Container läuft

- `node src/apps/cron/main.js`
- Cron-Ausführung über `node-cron`
- Web-UI auf Port `3030`
- Settings-Speicherung in `/app/config/app-settings.json`

## Voraussetzungen

- Docker
- Docker Compose
- Eine ausgefüllte `.env`

## Start

```bash
docker compose up --build -d
```

Danach ist die UI erreichbar:

```text
http://localhost:3030
```

## Logs ansehen

```bash
docker compose logs -f
```

## Container stoppen

```bash
docker compose down
```

## Wichtige Details

### 1. UI muss im Container auf `0.0.0.0` hören
Das ist in `docker-compose.yml` bereits gesetzt:

```env
UI_HOST=0.0.0.0
```

### 2. Einstellungen werden persistent gespeichert
Die Datei wird über ein Volume gemountet:

```yaml
volumes:
  - ./config:/app/config
```

Dadurch bleibt `app-settings.json` auch nach einem Neustart erhalten.

### 3. `SETTINGS_FILE_PATH` wird im Compose-File überschrieben
Das ist wichtig, weil die Host-Pfade aus der klassischen Server-Installation im Container nicht passen.

Im Container wird verwendet:

```env
SETTINGS_FILE_PATH=/app/config/app-settings.json
```

### 4. Port 3030 wird nach außen freigegeben

```yaml
ports:
  - "3030:3030"
```

## Optional: eigener Reverse Proxy

Wenn Mitarbeiter nicht direkt auf `:3030` zugreifen sollen, setze vor Docker einen Reverse Proxy wie Nginx oder Traefik.

Typischer Aufbau:

```text
Browser -> HTTPS 443 -> Reverse Proxy -> Docker Container :3030
```

## Empfohlene Reihenfolge

1. `.env` prüfen
2. `docker compose up --build -d`
3. UI öffnen
4. Profil anlegen
5. Speicher testen
6. Cron-Lauf testen

