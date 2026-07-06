#!/bin/bash

# Port to check/run on
PORT=8000

echo "Restarting backend..."

# Find and kill any process using port 8000
PID=$(lsof -t -i:$PORT)
if [ -n "$PID" ]; then
    echo "Found existing process on port $PORT (PID: $PID). Killing it..."
    kill -9 $PID
    sleep 1
else
    echo "Port $PORT is free."
fi

# Ensure we are in the backend directory
CDIR=$(basename "$PWD")
if [ "$CDIR" != "backend" ]; then
    if [ -d "backend" ]; then
        cd backend
    else
        echo "❌ Error: Could not find backend directory."
        exit 1
    fi
fi

# Run the backend using the virtual environment
if [ -f "venv/bin/uvicorn" ]; then
    echo "Starting backend server on port $PORT..."
    exec venv/bin/uvicorn src.main:app --reload --port $PORT
else
    echo "Error: Virtual environment (venv/bin/uvicorn) not found."
    exit 1
fi
