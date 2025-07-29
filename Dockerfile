ARG VARIANT=20-slim
FROM node:\${VARIANT}

# Install system dependencies, Chromium, FFmpeg, PulseAudio

RUN apt-get update &&&#x20;
apt-get install -y --no-install-recommends&#x20;
curl pulseaudio fonts-noto-color-emoji&#x20;
libxtst6 libxrandr2 libgtk-3-0 libgbm1 libnss3&#x20;
libatk1.0-0 libatk-bridge2.0-0 libcups2 libx11-xcb1&#x20;
libxcomposite1 libxdamage1 libxss1 libasound2&#x20;
chromium ffmpeg &&&#x20;
rm -rf /var/lib/apt/lists/\*

# Puppeteer environment variables

ENV PUPPETEER\_SKIP\_DOWNLOAD=true&#x20;
PUPPETEER\_EXECUTABLE\_PATH=/usr/bin/chromium

# Create non-root user

RUN useradd --create-home recorder

USER recorder
WORKDIR /home/recorder

# Install Node.js dependencies

COPY --chown=recorder\:recorder package.json package-lock.json ./
RUN npm install --omit=dev --legacy-peer-deps

# Copy application code

COPY --chown=recorder\:recorder . .

# Expose port if serving web UI

EXPOSE 3000

# Run the in-tab recording script

ENTRYPOINT \["node", "record.js"]
