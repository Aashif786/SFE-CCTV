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

# 2. Check Docker
if ! command -v docker &> /dev/null; then
    echo "❌ Error: Docker is not installed or not available in PATH."
    exit 1
fi

# 3. Start Database and Backend via Docker
echo "🐳 Starting Database and Backend containers..."
if docker compose version &> /dev/null; then
    docker compose up -d db backend
else
    docker-compose up -d db backend
fi

# 4. Start Frontend
echo "🚀 Starting Frontend in the background..."
(cd frontend && npm run dev) &
FRONTEND_PID=$!

# Handle graceful shutdown
cleanup() {
    echo ""
    echo "🛑 Shutting down CALVISION..."
    kill $FRONTEND_PID 2>/dev/null
    wait $FRONTEND_PID 2>/dev/null
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

# Wait for background frontend process
wait
