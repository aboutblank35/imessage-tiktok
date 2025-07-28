ARG VARIANT=20-slim
FROM node:${VARIANT}

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl xvfb pulseaudio ffmpeg chromium fonts-noto-color-emoji \
    libxtst6 libxrandr2 libgtk-3-0 libgbm1 libnss3 \
    libatk1.0-0 libatk-bridge2.0-0 libcups2 libx11-xcb1 \
    libxcomposite1 libxdamage1 libxss1 libasound2 \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_DOWNLOAD="true"
ENV PUPPETEER_EXECUTABLE_PATH="/usr/bin/chromium"

RUN useradd --create-home recorder
RUN mkdir -p /tmp/.X11-unix && chmod 1777 /tmp/.X11-unix

USER recorder
WORKDIR /home/recorder

COPY --chown=recorder:recorder package.json package-lock.json ./
RUN npm install --omit=dev --legacy-peer-deps

COPY --chown=recorder:recorder . .

EXPOSE 3000

ENTRYPOINT ["sh","-c","\
    Xvfb :99 -screen 0 720x1280x24 & \
    sleep 1 && \
    export DISPLAY=:99 && \
    npm run start & \
    until curl -s http://localhost:3000 >/dev/null; do sleep 1; done && \
    sleep 1 && \
    node record/record.js"]
