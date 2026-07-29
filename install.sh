#!/bin/bash
set -e

echo "========================================="
echo "   CALVISION Linux Setup                 "
echo "========================================="

# 1. Determine if Nix is available and functional
USE_NIX=true
if ! command -v nix &> /dev/null || ! nix-instantiate --eval -E '1 + 1' &> /dev/null; then
    echo "⚠️  Warning: Nix is not installed or is broken/inactive on this host."
    echo "Falling back to standard Python venv and Node.js setup."
    USE_NIX=false
else
    echo "✅ Nix is installed and functional."
fi

# 2. Verify Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Error: Docker is not installed (required for PostgreSQL)."
    echo "Please install Docker."
    exit 1
fi
echo "✅ Docker is installed."

# 3. Create .env if it doesn't exist
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

# 4. Install dependencies
if [ "$USE_NIX" = true ]; then
    echo "❄️  Installing frontend dependencies inside Nix shell..."
    nix --extra-experimental-features "nix-command flakes" develop -c bash -c "cd frontend && npm install"
else
    # Verify system prerequisites for standard setup
    if ! command -v python3 &> /dev/null; then
        echo "❌ Error: python3 is required but not installed."
        exit 1
    fi
    if ! command -v npm &> /dev/null; then
        echo "❌ Error: npm is required but not installed."
        exit 1
    fi
    
    echo "🐍 Setting up Python Virtual Environment..."
    if [ ! -d "backend/venv" ]; then
        python3 -m venv backend/venv
    fi
    
    echo "📦 Installing backend dependencies..."
    if [ -f "backend/requirements.lock" ]; then
        backend/venv/bin/pip install -r backend/requirements.lock
    elif [ -f "backend/requirements.txt" ]; then
        backend/venv/bin/pip install -r backend/requirements.txt
    fi

    echo "📦 Installing frontend dependencies..."
    (cd frontend && npm install)
fi

# 5. Pull Docker images
echo "🐳 Pulling Docker images..."
if [ -f "docker-compose.yml" ]; then
    docker compose pull db || docker-compose pull db
fi

echo "========================================="
echo "✅ Setup complete!"
echo "Run ./start.sh to launch the application."
echo "========================================="
