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

# 3. Check Backend virtualenv
if [ ! -f backend/venv/bin/uvicorn ]; then
    echo "❌ Error: Backend virtual environment not found (backend/venv)."
    echo "Please run ./install.sh first."
    exit 1
fi

# 4. Check Frontend dependencies
if [ ! -d frontend/node_modules ]; then
    echo "📦 Frontend node_modules not found. Installing frontend dependencies..."
    (cd frontend && npm install)
fi

# 4. Clean up existing processes on ports 3001 and 8001 if running
for PORT in 8001 3001; do
    PID=$(lsof -t -i:$PORT 2>/dev/null || true)
    if [ -n "$PID" ]; then
        echo "🧹 Cleaning up existing process on port $PORT (PID: $PID)..."
        kill -9 $PID 2>/dev/null || true
    fi
done

# 5. Start Database Container
echo "🐳 Starting PostgreSQL Database container..."
if docker compose version &> /dev/null; then
    docker compose up -d db
else
    docker-compose up -d db
fi

# Set DATABASE_URL environment variable for native backend connection to PostgreSQL container
export DATABASE_URL="${DATABASE_URL:-postgresql+pg8000://postgres:password@127.0.0.1:5433/worker_monitor}"

# 6. Start Backend Natively
echo "🐍 Starting Backend API server in the background..."
(cd backend && ./venv/bin/uvicorn src.main:app --reload --host 0.0.0.0 --port 8001) &
BACKEND_PID=$!

# 7. Start Frontend
echo " Starting Frontend in the background..."
(cd frontend && npm run dev) &
FRONTEND_PID=$!

# Handle graceful shutdown
cleanup() {
    echo ""
    echo "🛑 Shutting down CALVISION..."
    kill $BACKEND_PID 2>/dev/null
    kill $FRONTEND_PID 2>/dev/null
    wait $BACKEND_PID $FRONTEND_PID 2>/dev/null
    echo "✅ Shutdown complete."
    exit 0
}

trap cleanup SIGINT SIGTERM

echo "========================================="
echo "✅ System is running."
echo "   - Frontend: http://localhost:3001"
echo "   - Backend API: http://localhost:8001"
echo "Press Ctrl+C to stop."
echo "========================================="

# Wait for background processes
wait

