{
  description = "CALVISION — Native Reproducible Environment (Nix Alternative to Docker)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs {
          inherit system;
          config = {
            allowUnfree = true; # Required for NVIDIA CUDA drivers & libraries
          };
        };

        pythonEnv = pkgs.python310.withPackages (ps: with ps; [
          fastapi
          uvicorn
          pydantic
          pydantic-settings
          sqlalchemy
          alembic
          pg8000
          ultralytics
          python-multipart
          websockets
          opencv4
          numpy
          cryptography
          torch-bin
          torchvision-bin
          scipy
          pillow
          requests
          pyyaml
          python-dotenv
        ]);

        # System libraries required natively for OpenCV, CUDA, and FFmpeg
        runtimeLibs = with pkgs; [
          stdenv.cc.cc.lib
          zlib
          glib
          libGL
          libglvnd
          ffmpeg
          openssl
          cudaPackages.cuda_nvcc
          cudaPackages.cudnn
        ];

        libPath = pkgs.lib.makeLibraryPath runtimeLibs;

        # Native start scripts
        backendScript = pkgs.writeShellScriptBin "run-backend" ''
          export LD_LIBRARY_PATH="${libPath}:$LD_LIBRARY_PATH"
          export PYTHONPATH="$PWD/backend/src:$PYTHONPATH"
          echo "🚀 Starting CALVISION Backend (Native Nix Runtime)..."
          cd backend && ${pythonEnv}/bin/uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload
        '';

        frontendScript = pkgs.writeShellScriptBin "run-frontend" ''
          echo "🚀 Starting CALVISION Frontend (Native Nix Runtime)..."
          cd frontend && ${pkgs.nodejs_20}/bin/npm run dev
        '';

      in {
        # ── Native Reproducible Environment (nix develop / nix-shell) ────
        devShells.default = pkgs.mkShell {
          name = "calvision-native-env";

          buildInputs = [
            pythonEnv
            pkgs.nodejs_20
            pkgs.postgresql_15
            pkgs.curl
            pkgs.jq
            backendScript
            frontendScript
          ] ++ runtimeLibs;

          shellHook = ''
            export LD_LIBRARY_PATH="${libPath}:$LD_LIBRARY_PATH"
            export PYTHONPATH="$PWD/backend/src:$PYTHONPATH"
            echo "═════════════════════════════════════════════════════════════════"
            echo " ❄️ CALVISION Native Nix Environment (Zero Docker Containerization)"
            echo "   • Python : $(python --version)"
            echo "   • Node   : $(node --version)"
            echo "   • CUDA   : Native Host GPU Enabled"
            echo "   • Run    : 'run-backend'  (starts FastAPI backend)"
            echo "            : 'run-frontend' (starts Next.js frontend)"
            echo "═════════════════════════════════════════════════════════════════"
          '';
        };

        # ── Native Executable Apps (nix run .#backend / nix run .#frontend) ──
        apps = {
          backend = {
            type = "app";
            program = "${backendScript}/bin/run-backend";
          };
          frontend = {
            type = "app";
            program = "${frontendScript}/bin/run-frontend";
          };
        };
      }
    );
}
