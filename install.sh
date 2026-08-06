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

# 5. Pull Database Docker Container
echo "🐳 Pulling PostgreSQL database container..."
if docker compose version &> /dev/null; then
    docker compose pull db
else
    docker-compose pull db
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

