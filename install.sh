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

    PYBIN="backend/venv/bin/python"

    # ── GPU-accelerated PyTorch ──────────────────────────────────────────
    # Install PyTorch with CUDA 12.4 if a CUDA-capable GPU is available,
    # otherwise fall back to the CPU-only build.
    echo "🔍 Detecting GPU availability..."
    if command -v nvidia-smi &> /dev/null && nvidia-smi &> /dev/null; then
        echo "🚀 NVIDIA GPU detected — installing PyTorch with CUDA 12.4 support..."
        "$PYBIN" -m pip install --upgrade pip
        "$PYBIN" -m pip install torch torchvision \
            --index-url https://download.pytorch.org/whl/cu124
        "$PYBIN" -m pip install onnxruntime-gpu
    else
        echo "⚠️  No NVIDIA GPU found — installing CPU-only PyTorch..."
        "$PYBIN" -m pip install --upgrade pip
        "$PYBIN" -m pip install torch torchvision \
            --index-url https://download.pytorch.org/whl/cpu
        "$PYBIN" -m pip install onnxruntime
    fi
    # ─────────────────────────────────────────────────────────────────────

    echo "📦 Installing backend dependencies..."
    if [ -f "backend/requirements.txt" ]; then
        # Exclude torch/onnxruntime so we don't overwrite the GPU build above
        grep -v -E "^(torch|torchvision|onnxruntime)" backend/requirements.txt \
            | "$PYBIN" -m pip install -r /dev/stdin
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
