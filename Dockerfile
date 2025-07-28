# Dockerfile – Headless Chat Recorder (ARM64/AMD64 compatible)
ARG VARIANT=20-slim
FROM node:${VARIANT}

# 1) System-Dependencies installieren
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl xvfb pulseaudio ffmpeg chromium \
    libxtst6 libxrandr2 libgtk-3-0 libgbm1 libnss3 \
    libatk1.0-0 libatk-bridge2.0-0 libcups2 libx11-xcb1 \
    libxcomposite1 libxdamage1 libxss1 libasound2 \
    && rm -rf /var/lib/apt/lists/*

# 2) Puppeteer soll das System-Chromium verwenden
ENV PUPPETEER_SKIP_DOWNLOAD="true"
ENV PUPPETEER_EXECUTABLE_PATH="/usr/bin/chromium"

# 3) Nicht-root User anlegen
RUN useradd --create-home recorder

# 4) X11-Socket­verzeichnis anlegen (für Xvfb)
RUN mkdir -p /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix

# 5) In den recorder-User wechseln
USER recorder
WORKDIR /home/recorder

# 6) Node-Dependencies installieren
COPY --chown=recorder:recorder package.json package-lock.json ./
RUN npm install --omit=dev --legacy-peer-deps

# 7) Anwendungscode kopieren
COPY --chown=recorder:recorder . .

# 8) Port für live-server freigeben
EXPOSE 3000

# 9) ENTRYPOINT: Xvfb, live-server und dann record/record.js starten
ENTRYPOINT ["sh","-c","\
    # 1) Xvfb mit Portrait-Auflösung starten \
    Xvfb :99 -screen 0 720x1280x24 & \
    sleep 1 && \
    export DISPLAY=:99 && \
    npm run start & \
    # 2) Warten bis live-server hoch ist \
    until curl -s http://localhost:3000 >/dev/null; do sleep 1; done && \
    sleep 1 && \
    # 3) Aufnahme starten \
    node record/record.js"]
