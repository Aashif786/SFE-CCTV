# Classic nix-shell entrypoint for CALVISION
# Falls back to flake.nix if available or builds standard reproducible shell

{ pkgs ? import <nixpkgs> { config.allowUnfree = true; } }:

let
  flake = builtins.getFlake (toString ./.);
in
  if (builtins.pathExists ./.nix-flake-compat) then
    flake.devShells.${builtins.currentSystem}.default
  else
    pkgs.mkShell {
      name = "calvision-shell";
      buildInputs = with pkgs; [
        python310
        nodejs_20
        postgresql_15
        ffmpeg
        libGL
        glib
      ];
      shellHook = ''
        echo "🚀 CALVISION Classic Nix Shell Loaded"
      '';
    }
