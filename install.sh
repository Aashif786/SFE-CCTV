#!/bin/bash
set -e

echo "========================================="
echo "   CALVISION Linux Setup (Nix-based)     "
echo "========================================="

# 1. Verify Nix is installed
if ! command -v nix &> /dev/null; then
    echo "❌ Error: Nix is not installed."
    echo "Please install Nix to proceed: https://nixos.org/download/"
    exit 1
fi

echo "✅ Nix is installed."

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

# 4. Install frontend dependencies within Nix shell
echo "📦 Installing frontend dependencies..."
nix develop -c bash -c "cd frontend && npm install"

# 5. Pull Docker images
echo "🐳 Pulling Docker images..."
if [ -f "docker-compose.yml" ]; then
    docker compose pull db || docker-compose pull db
fi

echo "========================================="
echo "✅ Setup complete!"
echo "Run ./start.sh to launch the application."
echo "========================================="
