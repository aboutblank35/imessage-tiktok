ARG VARIANT=20-slim
FROM node:\${VARIANT}

# Install system deps

RUN apt-get update && apt-get install -y --no-install-recommends&#x20;
curl xvfb pulseaudio fonts-noto-color-emoji&#x20;
libxtst6 libxrandr2 libgtk-3-0 libgbm1 libnss3&#x20;
libatk1.0-0 libatk-bridge2.0-0 libcups2 libx11-xcb1&#x20;
libxcomposite1 libxdamage1 libxss1 libasound2&#x20;
&& rm -rf /var/lib/apt/lists/\*

# Puppeteer needs Chromium

RUN apt-get update && apt-get install -y chromium ffmpeg&#x20;
&& rm -rf /var/lib/apt/lists/\*

ENV PUPPETEER\_SKIP\_DOWNLOAD=true&#x20;
PUPPETEER\_EXECUTABLE\_PATH=/usr/bin/chromium

# Create unprivileged user

RUN useradd --create-home recorder

USER recorder
WORKDIR /home/recorder

# Copy package files and install dependencies

COPY --chown=recorder\:recorder package.json package-lock.json ./
RUN npm install --omit=dev --legacy-peer-deps

# Copy source

COPY --chown=recorder\:recorder . .

# Expose app port (if you run server)

EXPOSE 3000

# Start recording directly (no Xvfb needed with in‑tab stream)

ENTRYPOINT \["sh","-c","node record.js"]
