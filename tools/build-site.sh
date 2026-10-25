#!/usr/bin/env sh
# Bouwt de browserversie van Thuisaccu als statische site (standaard in site/), bijvoorbeeld voor
# GitHub Pages. Nodig: `rustup target add wasm32-unknown-unknown`, clang (SQLite wordt naar
# WebAssembly gecompileerd) en wasm-bindgen-cli in dezelfde versie als in Cargo.lock.
set -eu
cd "$(dirname "$0")/.."
out="${1:-site}"

want=$(grep -A1 '^name = "wasm-bindgen"$' Cargo.lock | tail -1 | cut -d'"' -f2)
have=$(wasm-bindgen --version | cut -d' ' -f2)
if [ "$want" != "$have" ]; then
    echo "wasm-bindgen-cli is $have, Cargo.lock gebruikt $want." >&2
    echo "Installeer: cargo install wasm-bindgen-cli --version $want --locked" >&2
    exit 1
fi

cargo build --locked --profile wasm -p thuisaccu-browser --target wasm32-unknown-unknown
rm -rf "$out"
mkdir -p "$out"
wasm-bindgen --target web --no-typescript --out-dir "$out/pkg" \
    target/wasm32-unknown-unknown/wasm/thuisaccu_browser.wasm
cp web/*.js web/styles.css "$out/"
sed 's/data-backend="server"/data-backend="browser"/' web/index.html > "$out/index.html"
grep -q 'data-backend="browser"' "$out/index.html"
echo "Statische site in $out/"
