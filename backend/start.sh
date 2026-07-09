#!/bin/bash

# Port to check/run on
PORT=8000
IP_ADDRESS="0.0.0.0"
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

# Ensure PostgreSQL container is running if docker-compose.yml exists
if [ -f "../docker-compose.yml" ]; then
    echo "🐳 Ensuring PostgreSQL database container is running..."
    docker compose -f ../docker-compose.yml up -d db
elif [ -f "docker-compose.yml" ]; then
    echo "🐳 Ensuring PostgreSQL database container is running..."
    docker compose up -d db
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
    exec venv/bin/uvicorn src.main:app --reload --host $IP_ADDRESS --port $PORT 
else
    echo "Error: Virtual environment (venv/bin/uvicorn) not found."
    exit 1
fi
