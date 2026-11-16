# Arena Chispa – servidor de clasificación

Un solo servicio sirve el juego y la API. No tiene dependencias (solo Node 18+).

## Probar en tu computador
    node server.js          # abre http://localhost:3000

## Publicarlo (ejemplo con Railway / Fly.io / Render / cualquier VPS)
1. Sube esta carpeta a un repositorio de GitHub.
2. Crea un servicio Node apuntando al repo. Comando de inicio: `npm start`.
3. IMPORTANTE – guardado de datos: las marcas se guardan en un archivo JSON
   (`DATA_DIR/leaderboard.json`). Si el servicio reinicia en un disco temporal
   (plan gratis de Render, por ejemplo) se borran. Monta un volumen/disco
   persistente y pon la variable `DATA_DIR` apuntando a él (ej. `/data`).
4. Abre la URL pública: ese es tu juego con clasificación global.

Si prefieres alojar el juego en otro sitio, cambia `LB_API` en index.html
(`const LB_API = 'https://tu-servidor.com'`); la API ya permite CORS.

## API
- GET  /api/top?cat=c|w|m&name=Usuario   → top 10 (copas, oleada, monedas) + tu puesto
- POST /api/claim  {name, token}         → reservar/cambiar username (409 si está tomado)
- POST /api/score  {name, token, c, w, m}→ enviar marcas (solo suben)
El `token` lo genera el juego y queda en el dispositivo: es lo que evita que otro robe tu nombre.
