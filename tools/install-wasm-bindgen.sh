#!/usr/bin/env sh
# Installeert de voorgebouwde wasm-bindgen-cli voor Linux (x86_64) in precies de versie van
# wasm-bindgen in Cargo.lock, met controle van het SHA-256-controlegetal. Sneller dan
# `cargo install`; bedoeld voor CI. Doel: ~/.cargo/bin, of de map in het eerste argument.
set -eu
cd "$(dirname "$0")/.."
bin="${1:-$HOME/.cargo/bin}"
version=$(grep -A1 '^name = "wasm-bindgen"$' Cargo.lock | tail -1 | cut -d'"' -f2)
name="wasm-bindgen-$version-x86_64-unknown-linux-musl"
url="https://github.com/wasm-bindgen/wasm-bindgen/releases/download/$version/$name.tar.gz"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fsSL --retry 3 -o "$tmp/$name.tar.gz" "$url"
curl -fsSL --retry 3 -o "$tmp/$name.tar.gz.sha256sum" "$url.sha256sum"
(cd "$tmp" && sha256sum -c "$name.tar.gz.sha256sum")
tar -xzf "$tmp/$name.tar.gz" -C "$tmp"
mkdir -p "$bin"
install -m 755 "$tmp/$name/wasm-bindgen" "$bin/wasm-bindgen"
"$bin/wasm-bindgen" --version
