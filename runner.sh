#!/bin/bash
set -x  # trace commands

# Start Xvfb virtual display
export DISPLAY=:99
Xvfb :99 -screen 0 1080x1920x24 &
sleep 2

# Check Xvfb
echo "Xvfb PID: $(pidof Xvfb || echo 'not running')"

# Start live-server from local node_modules with verbose output
cd /home/recorder/public
echo "Starting live-server on port 53694..."
node /home/recorder/node_modules/.bin/live-server --port=53694 --no-browser 2>&1 &
SERVER_PID=$!
echo "Server PID: $SERVER_PID"
cd /home/recorder
sleep 5

# Check if server is listening
echo "Checking netstat..."
netstat -tlnp 2>/dev/null || ss -tlnp 2>/dev/null || echo "no netstat"

# Verify server
echo "Testing server..."
for i in $(seq 1 20); do
  echo "Attempt $i..."
  if curl -s -m 2 http://127.0.0.1:53694 >/dev/null 2>&1; then
    echo "Server ready on port 53694"
    break
  fi
  sleep 1
done

# Run recording
echo "Starting recording..."
node /home/recorder/record/record_mac.js
echo "Exit code: $?"
