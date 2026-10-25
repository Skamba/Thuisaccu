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

# GitHub Pages laat de browser bestanden tien minuten uit de cache gebruiken. Zonder versie
# kan een nieuwe pagina dan met een oude worker of WebAssembly-module praten (bijvoorbeeld 404
# op een nieuwe route). Iedere build krijgt daarom een versie in alle onderlinge verwijzingen.
version=$(cat "$out"/*.js "$out/styles.css" "$out"/pkg/* | sha256sum | cut -c1-12)
stamp() { # bestand, oude tekst, nieuwe tekst
    grep -qF "$2" "$1" || { echo "Verwijzing $2 niet gevonden in $1." >&2; exit 1; }
    sed "s|$2|$3|g" "$1" > "$1.tmp" && mv "$1.tmp" "$1"
}
for script in "$out"/*.js; do
    name=$(basename "$script")
    [ "$name" = worker.js ] || stamp "$out/index.html" "src=\"$name\"" "src=\"$name?v=$version\""
done
stamp "$out/index.html" 'href="styles.css"' "href=\"styles.css?v=$version\""
stamp "$out/local.js" '"worker.js"' "\"worker.js?v=$version\""
stamp "$out/worker.js" '"./pkg/thuisaccu_browser.js"' "\"./pkg/thuisaccu_browser.js?v=$version\""
stamp "$out/pkg/thuisaccu_browser.js" "'thuisaccu_browser_bg.wasm'" "'thuisaccu_browser_bg.wasm?v=$version'"
echo "Statische site in $out/ (versie $version)"
