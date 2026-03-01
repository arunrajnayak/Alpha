#!/bin/bash

# Alpha Cron Setup Script
# Automatically configures the crontab for daily Zerodha orders sync.

# 1. Detect Node and NPX paths
NODE_PATH=$(which node)
NPX_PATH=$(which npx)
PROJECT_DIR=$(pwd)

if [ -z "$NPX_PATH" ]; then
    echo "Error: 'npx' not found in PATH. Please ensure Node.js is installed."
    exit 1
fi

echo "Found npx at: $NPX_PATH"
echo "Project dir:  $PROJECT_DIR"

# 2. Define the Cron Command
# Runs at 3:40 PM every weekday (Mon-Fri)
CRON_SCHEDULE="40 15 * * 1-5"
SCRIPT_PATH="src/scripts/zerodha-cron.ts"
LOG_FILE="/tmp/alpha-zerodha-sync.log"

# Construct the full command
# We use 'cd' to ensure we run from project root, then execute the script
FULL_COMMAND="$CRON_SCHEDULE cd $PROJECT_DIR && $NPX_PATH tsx $SCRIPT_PATH >> $LOG_FILE 2>&1"

# 3. Check if already exists
EXISTING_CRON=$(crontab -l 2>/dev/null)
if echo "$EXISTING_CRON" | grep -q "zerodha-cron.ts"; then
    echo "------------------------------------------------"
    echo "Notice: A Zerodha cron job usually already exists."
    echo "Current crontab entries for zerodha-cron:"
    echo "$EXISTING_CRON" | grep "zerodha-cron.ts"
    echo "------------------------------------------------"
    read -p "Do you want to replace it? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Aborted."
        exit 0
    fi
    # Remove old line
    EXISTING_CRON=$(echo "$EXISTING_CRON" | grep -v "zerodha-cron.ts")
fi

# 4. Install new Cron
echo "Installing new cron job..."
echo "$EXISTING_CRON" > /tmp/cron.bk
echo "$FULL_COMMAND" >> /tmp/cron.bk
crontab /tmp/cron.bk
rm /tmp/cron.bk

echo "------------------------------------------------"
echo "Success! Cron job configured."
echo "Schedule: $CRON_SCHEDULE (3:40 PM Mon-Fri)"
echo "Command:  $FULL_COMMAND"
echo "Logs:     $LOG_FILE"
echo "------------------------------------------------"
