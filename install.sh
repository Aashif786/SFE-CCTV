#!/bin/bash
set -e

echo "========================================="
echo "   CALVISION Linux Setup                 "
echo "========================================="

# 1. Verify Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Error: Docker is not installed (required for Backend & Database)."
    echo "Please install Docker first."
    exit 1
fi
echo "✅ Docker is installed."

# 2. Create .env and settings.json if they don't exist
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

# 3. Build & Pull Docker Containers (Backend + Database)
echo "🐳 Building and pulling Docker containers..."
if command -v docker &> /dev/null; then
    docker compose build backend || docker-compose build backend
    docker compose pull db || docker-compose pull db
fi

# 4. Install Frontend dependencies
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
