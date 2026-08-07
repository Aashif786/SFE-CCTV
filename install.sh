#!/bin/bash
set -e

echo "========================================="
echo "   CALVISION Linux Setup                 "
echo "========================================="

# 1. Verify Docker is installed (required for Database)
if ! command -v docker &> /dev/null; then
    echo "❌ Error: Docker is not installed (required for PostgreSQL database)."
    echo "Please install Docker first."
    exit 1
fi
echo "✅ Docker is installed."

# 2. Verify Python 3 is installed
if ! command -v python3 &> /dev/null; then
    echo "❌ Error: Python 3 is not installed (required for Backend)."
    echo "Please install Python 3 (3.10+) first."
    exit 1
fi
echo "✅ Python 3 is installed."

# 3. Create .env and settings.json if they don't exist
if [ ! -f .env ]; then
    if [ -f backend/.env.example ]; then
        echo "📝 Creating .env from backend/.env.example..."
        cp backend/.env.example .env
    else
        echo "⚠️  Could not find backend/.env.example to create .env."
    fi
else
    echo "✅ .env file already exists."
fi

if [ ! -f backend/settings.json ]; then
    if [ -f backend/settings.example.json ]; then
        echo "📝 Creating backend/settings.json from backend/settings.example.json..."
        cp backend/settings.example.json backend/settings.json
    fi
else
    echo "✅ backend/settings.json already exists."
fi

# 4. Setup Backend Python Virtual Environment
echo "🐍 Setting up Backend Python virtual environment..."
if [ ! -d "backend/venv" ]; then
    python3 -m venv backend/venv
fi

echo "📦 Installing backend Python dependencies..."
backend/venv/bin/pip install --upgrade pip
backend/venv/bin/pip install -r backend/requirements.txt

# 5. Pull, create, and verify the PostgreSQL database container
echo "🐳 Pulling PostgreSQL Docker image..."
if docker compose version &> /dev/null; then
    COMPOSE_CMD="docker compose"
else
    COMPOSE_CMD="docker-compose"
fi

$COMPOSE_CMD pull db || echo "⚠️  Image pull failed (offline?). Will try with cached image."

# Create and start the container (idempotent — safe to re-run)
echo "🐳 Creating and starting the PostgreSQL database container..."
$COMPOSE_CMD up -d db
if [ $? -ne 0 ]; then
    echo "❌ Failed to start the PostgreSQL container via Docker Compose."
    exit 1
fi

# Wait for healthcheck to pass
echo "⏳ Waiting for PostgreSQL to become healthy (up to 60s)..."
DB_READY=false
for i in $(seq 1 30); do
    HEALTH=$(docker inspect --format '{{.State.Health.Status}}' worker_monitor_db 2>/dev/null || echo "missing")
    if [ "$HEALTH" = "healthy" ]; then
        DB_READY=true
        break
    elif [ "$HEALTH" = "unhealthy" ]; then
        echo "❌ PostgreSQL container is unhealthy."
        echo "Run 'docker compose logs db' to see the database error."
        exit 1
    fi
    sleep 2
done

if [ "$DB_READY" = true ]; then
    echo "✅ PostgreSQL container is healthy and ready."
else
    echo "⚠️  PostgreSQL did not confirm healthy within 60s."
    echo "   The container is running but may still be initialising."
    echo "   start.sh will wait again — this is normal on first run."
fi

# 6. Install Frontend dependencies
if command -v npm &> /dev/null; then
    echo "📦 Installing frontend dependencies..."
    (cd frontend && npm install)
else
    echo "⚠️ Warning: npm is not installed on the host. Please install Node.js/npm for frontend."
fi

echo "========================================="
echo "✅ Setup complete!"
echo "Run ./start.sh to launch the application."
echo "========================================="

