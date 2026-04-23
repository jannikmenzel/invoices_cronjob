FROM node:18-alpine

WORKDIR /app

ENV NODE_ENV=production \
    UI_ENABLED=true \
    UI_HOST=0.0.0.0 \
    UI_PORT=3030 \
    SETTINGS_FILE_PATH=/app/config/app-settings.json \
    TEMP_DIR=/tmp/invoices_cronjob \
    KEEP_TEMP_FILES=false

COPY package*.json ./
RUN npm ci --omit=dev \
    && apk add --no-cache ghostscript

COPY public ./public
COPY src ./src
RUN npm run sync:bootstrap && mkdir -p /app/config /tmp/invoices_cronjob

EXPOSE 3030

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3030/

CMD ["node", "src/apps/cron/main.js"]

