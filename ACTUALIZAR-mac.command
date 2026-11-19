#!/bin/bash
# Doble clic acá (en Mac) para actualizar la app a la última versión.
# Tus artículos, plantillas y ajustes NO se borran: viven en el navegador.
REPO='SarkisMorales/paraimprimir'
BRANCH='claude/epic-dirac-dhv0f6'
APP="$(cd "$(dirname "$0")" && pwd)"
VERFILE="$APP/js/version.js"
fin() { echo; read -r -p 'Apretá Enter para cerrar...' _; exit "$1"; }

echo
echo '  ACTUALIZAR - Precios para góndola'
echo '  ---------------------------------'
echo
[ -f "$APP/index.html" ] || { echo '  No encuentro index.html: este archivo tiene que estar en la carpeta de la app.'; fin 1; }

LOCAL=$(grep -oE '[0-9a-f]{40}' "$VERFILE" 2>/dev/null | head -1)
echo '  Buscando si hay cambios nuevos...'
REMOTE=$(curl -fsSL -A paraimprimir-actualizador "https://api.github.com/repos/$REPO/commits/$BRANCH" 2>/dev/null | grep -oE '"sha": *"[0-9a-f]{40}"' | head -1 | grep -oE '[0-9a-f]{40}')

if [ -n "$REMOTE" ] && [ "$REMOTE" = "$LOCAL" ]; then
  echo; echo '  Ya tenés la última versión. No hay nada para actualizar.'; fin 0
fi

if [ -n "$REMOTE" ] && [ -n "$LOCAL" ]; then
  NEWS=$(curl -fsSL -A paraimprimir-actualizador "https://api.github.com/repos/$REPO/compare/$LOCAL...$REMOTE" 2>/dev/null \
    | grep -oE '"message": *"([^"\\]|\\.)*"' | tail -n +3 | sed -E 's/^"message": *"//; s/"$//; s/\\n.*//')
  if [ -n "$NEWS" ]; then echo; echo '  Novedades:'; echo "$NEWS" | sed 's/^/   - /'; fi
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
if [ -n "$REMOTE" ]; then URL="https://github.com/$REPO/archive/$REMOTE.zip"; else URL="https://github.com/$REPO/archive/refs/heads/$BRANCH.zip"; fi
echo; echo '  Bajando la versión nueva...'
if ! curl -fsSL -o "$TMP/app.zip" "$URL" || ! unzip -q "$TMP/app.zip" -d "$TMP/x"; then
  echo; echo '  No se pudo actualizar. Revisá que tengas internet y probá de nuevo.'; fin 1
fi
SRC=$(find "$TMP/x" -mindepth 1 -maxdepth 1 -type d | head -1)
[ -f "$SRC/index.html" ] || { echo '  El archivo bajado no tiene la app adentro.'; fin 1; }
cp -R "$SRC"/. "$APP"/
chmod +x "$APP/ACTUALIZAR-mac.command" 2>/dev/null
[ -n "$REMOTE" ] && echo "window.APP_VERSION = '$REMOTE';" > "$VERFILE"
echo
echo '  LISTO: app actualizada.'
echo '  Si la app está abierta en el navegador, apretá F5 para ver los cambios.'
echo '  Tus artículos, plantillas y ajustes siguen igual.'
fin 0
