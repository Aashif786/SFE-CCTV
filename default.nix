# Default Nix derivation for CALVISION
{ pkgs ? import <nixpkgs> { config.allowUnfree = true; } }:

pkgs.stdenv.mkDerivation {
  pname = "calvision";
  version = "2.0.0";

  src = ./.;

  buildInputs = with pkgs; [
    python310
    nodejs_20
  ];

  installPhase = ''
    mkdir -p $out
    cp -r * $out/
  '';
}
