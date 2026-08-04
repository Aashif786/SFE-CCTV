#!/bin/bash

echo "========================================="
echo "   Starting CALVISION                    "
echo "========================================="

# 1. Validate configuration
if [ ! -f .env ] && [ ! -f backend/.env ]; then
    echo "❌ Error: .env file not found."
    echo "Please run ./install.sh first."
    exit 1
fi

# 2. Determine if Nix is available and functional
USE_NIX=true
if ! command -v nix &> /dev/null || ! nix-instantiate --eval -E '1 + 1' &> /dev/null; then
    echo "⚠️  Warning: Nix is not available or is broken/inactive on this host. Using standard runtime..."
    USE_NIX=false
fi

# 2. Start PostgreSQL
if ! command -v docker &> /dev/null; then
    echo "⚠️  Warning: Docker not found. Assuming database is managed externally."
else
    echo "🐳 Starting database..."
    # Check if a container with the same name already exists
    if docker ps -a --format '{{.Names}}' | grep -q "^worker_monitor_db$"; then
        echo "🐳 Starting existing worker_monitor_db container..."
        docker start worker_monitor_db || true
    else
        if [ -f "docker-compose.yml" ]; then
            docker compose up -d db || docker-compose up -d db || true
        elif [ -f "backend/docker-compose.yml" ]; then
            cd backend && (docker compose up -d db || docker-compose up -d db || true) && cd ..
        fi
    fi
fi

# 4. Start services
echo "🚀 Starting backend and frontend in the background..."

if [ "$USE_NIX" = true ]; then
    # Run via Nix with experimental features explicitly enabled
    nix --extra-experimental-features "nix-command flakes" run .#backend &
    BACKEND_PID=$!

    nix --extra-experimental-features "nix-command flakes" run .#frontend &
    FRONTEND_PID=$!
else
    # Run via standard Python venv and npm
    if [ ! -f "backend/venv/bin/uvicorn" ]; then
        echo "❌ Error: Python virtual environment uvicorn not found. Please run ./install.sh"
        exit 1
    fi
    
    # Run backend from the backend folder to ensure src package is found
    (cd backend && PYTHONPATH="src:$PYTHONPATH" venv/bin/uvicorn src.main:app --host 0.0.0.0 --port 8000) &
    BACKEND_PID=$!

    # Run frontend
    (cd frontend && npm run dev) &
    FRONTEND_PID=$!
fi

# Handle graceful shutdown
cleanup() {
    echo ""
    echo "🛑 Shutting down CALVISION..."
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null
    wait $BACKEND_PID $FRONTEND_PID 2>/dev/null
    echo "✅ Shutdown complete."
    exit 0
}

trap cleanup SIGINT SIGTERM

echo "========================================="
echo "✅ System is running."
echo "   - Frontend: http://localhost:3000"
echo "   - Backend API: http://localhost:8000"
echo "Press Ctrl+C to stop."
echo "========================================="

# Wait for background processes
wait
