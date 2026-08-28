#!/bin/bash
set -e

# Always run from the project root directory
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

echo "========================================="
echo "   Starting CALVISION                    "
echo "========================================="

# 1. Validate configuration
if [ ! -f .env ] && [ ! -f backend/.env ]; then
    if [ -f backend/.env.example ]; then
        echo "📝 Creating .env from backend/.env.example..."
        cp backend/.env.example .env
    else
        echo "❌ Error: .env file not found."
        echo "Please run ./install.sh first."
        exit 1
    fi
fi

if [ ! -f backend/settings.json ] && [ -f backend/settings.example.json ]; then
    echo "📝 Creating backend/settings.json from backend/settings.example.json..."
    cp backend/settings.example.json backend/settings.json
fi

# 2. Check Docker and Docker Engine
if ! command -v docker &> /dev/null; then
    echo "❌ Error: Docker is not installed or not available in PATH."
    exit 1
fi

if ! docker info &> /dev/null; then
    echo "❌ Error: Docker daemon is not running or accessible."
    echo "Please start the Docker service (e.g., 'sudo systemctl start docker' or start Docker Desktop) and retry."
    exit 1
fi

# Determine compose command
if docker compose version &> /dev/null; then
    COMPOSE_CMD="docker compose"
else
    COMPOSE_CMD="docker-compose"
fi

# 3. Check Backend virtualenv
PYTHON_BIN="$PROJECT_ROOT/backend/venv/bin/python"
UVICORN_BIN="$PROJECT_ROOT/backend/venv/bin/uvicorn"

if [ ! -f "$PYTHON_BIN" ]; then
    echo "❌ Error: Backend virtual environment not found (backend/venv)."
    echo "Please run ./install.sh first."
    exit 1
fi

# 4. Check Frontend dependencies
if [ ! -d frontend/node_modules ]; then
    if command -v npm &> /dev/null; then
        echo "📦 Frontend node_modules not found. Installing frontend dependencies..."
        (cd frontend && npm install)
    else
        echo "⚠️ Warning: frontend/node_modules not found and npm is not installed."
    fi
fi

# 5. Clean up existing processes on ports 3001 and 8001 if running
for PORT in 8001 3001; do
    PIDS=$(lsof -t -i:$PORT 2>/dev/null || true)
    if [ -n "$PIDS" ]; then
        for PID in $PIDS; do
            echo "🧹 Cleaning up existing process on port $PORT (PID: $PID)..."
            kill -9 "$PID" 2>/dev/null || true
        done
    fi
done

# 6. Start Database Container
echo "🐳 Starting PostgreSQL Database container..."
$COMPOSE_CMD up -d db

# Wait for PostgreSQL container to become healthy (up to 30s)
echo "⏳ Waiting for PostgreSQL to be ready..."
DB_READY=false
for i in $(seq 1 15); do
    TARGET_CONTAINER=$($COMPOSE_CMD ps -q db 2>/dev/null || echo "worker_monitor_db")
    if [ -z "$TARGET_CONTAINER" ]; then
        TARGET_CONTAINER="worker_monitor_db"
    fi
    HEALTH=$(docker inspect --format '{{.State.Health.Status}}' "$TARGET_CONTAINER" 2>/dev/null || echo "missing")
    if [ "$HEALTH" = "healthy" ]; then
        DB_READY=true
        break
    fi
    sleep 1
done

if [ "$DB_READY" = true ]; then
    echo "✅ Database is ready."
else
    echo "⚠️ Database container started (health status: $HEALTH)."
fi

# Synchronize database role password if needed
$COMPOSE_CMD exec -T db psql -U postgres -d worker_monitor -c "ALTER USER postgres WITH PASSWORD 'password';" 2>/dev/null || \
    docker exec worker_monitor_db psql -U postgres -d worker_monitor -c "ALTER USER postgres WITH PASSWORD 'password';" 2>/dev/null || true

# Set DATABASE_URL environment variable for native backend connection to PostgreSQL container
export DATABASE_URL="${DATABASE_URL:-postgresql+pg8000://postgres:password@127.0.0.1:5433/worker_monitor}"

# 7. Start Backend Natively
echo "🐍 Starting Backend API server in the background..."
(cd backend && "$PYTHON_BIN" -m uvicorn src.main:app --reload --host 0.0.0.0 --port 8001) &
BACKEND_PID=$!

# 8. Start Frontend
echo "🌐 Starting Frontend in the background..."
(cd frontend && npm run dev) &
FRONTEND_PID=$!

# Handle graceful shutdown
cleanup() {
    echo ""
    echo "🛑 Shutting down CALVISION..."
    kill "$BACKEND_PID" 2>/dev/null || true
    kill "$FRONTEND_PID" 2>/dev/null || true
    wait "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null || true
    echo "✅ Shutdown complete."
    exit 0
}

trap cleanup SIGINT SIGTERM EXIT

echo "========================================="
echo "✅ System is running."
echo "   - Frontend: http://localhost:3001"
echo "   - Backend API: http://localhost:8001"
echo "   - API Docs: http://localhost:8001/docs"
echo "Press Ctrl+C to stop."
echo "========================================="

# Temporarily disable exit-on-error for wait so Ctrl+C trap can execute smoothly
set +e

# Wait for background processes
wait "$BACKEND_PID" "$FRONTEND_PID" 2>/dev/null
