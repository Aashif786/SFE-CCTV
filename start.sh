#!/bin/bash

echo "========================================="
echo "   Starting CALVISION (Nix Environment)  "
echo "========================================="

# 1. Validate configuration
if [ ! -f .env ] && [ ! -f backend/.env ]; then
    echo "❌ Error: .env file not found."
    echo "Please run ./install.sh first."
    exit 1
fi

# 2. Start PostgreSQL
if ! command -v docker &> /dev/null; then
    echo "⚠️  Warning: Docker not found. Assuming database is managed externally."
else
    echo "🐳 Starting database..."
    if [ -f "docker-compose.yml" ]; then
        docker compose up -d db || docker-compose up -d db
    elif [ -f "backend/docker-compose.yml" ]; then
        cd backend && (docker compose up -d db || docker-compose up -d db) && cd ..
    fi
fi

# 3. Start services
echo "🚀 Starting backend and frontend in the background..."

# Run backend
nix run .#backend &
BACKEND_PID=$!

# Run frontend
nix run .#frontend &
FRONTEND_PID=$!

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
