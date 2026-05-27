ARG VARIANT=20-slim
FROM node:${VARIANT}

# Install system dependencies, ffmpeg, Xvfb
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      curl xvfb fonts-noto-color-emoji \
      libxtst6 libxrandr2 libgtk-3-0 libgbm1 libnss3 \
      libatk1.0-0 libatk-bridge2.0-0 libcups2 libx11-xcb1 \
      libxcomposite1 libxdamage1 libxss1 libasound2 \
      ffmpeg && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN useradd --create-home recorder

USER recorder
WORKDIR /home/recorder

# Install Node.js dependencies (no browser download needed)
COPY --chown=recorder:recorder package.json package-lock.json ./
RUN npm install --omit=dev --legacy-peer-deps

# Copy application code
COPY --chown=recorder:recorder . .

# Expose port
EXPOSE 53694

# Entry: start Xvfb, start simple static server, start recording
CMD bash -c 'Xvfb :99 -screen 0 1080x1920x24 & sleep 1 && node scripts/serve.js & sleep 2 && node record/record_mac.js'
