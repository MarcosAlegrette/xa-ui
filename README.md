# Xa contra los Cuatreros Galácticos — versión web

Remake web (Vite + TypeScript + Canvas 2D, sin backend) del juego de plataformas de la XO (Plan Ceibal, Batoví Games / Calcar, 2010).
Usa **el arte, la música, los sonidos, los textos y los 16 mapas originales** de `../original` (extraídos del instalador).

## Correr

```bash
nvm use            # Node 22 (.nvmrc); sirve cualquier Node >= 20.19
npm install
npm run dev        # http://localhost:5203
npm run build      # tsc + vite build → dist/
npm run preview    # sirve dist/ en http://localhost:5203
```

### Pruebas de física (Node, sin navegador)

```bash
npm run test:physics   # salto, salto variable, doble salto (flanco, tras caer de un borde, coyote), búfer, aceleración, anti-túnel
```

### Regenerar assets y datos (sólo local)

```bash
cd tools/upscale && npm install && cd ../..   # una vez: modelo ESRGAN (UpscalerJS + TensorFlow.js/WASM), NO va a Amplify
npm run prepare-game                          # = npm run assets && npm run data
```

- `scripts/build-assets.mjs` → `public/assets/img/**` + `src/data/assets.json` (manifiesto con variantes y hashes):
  - **Set original** (`.o<ancho>.webp`): el arte tal cual, para la opción *Gráficos originales*.
  - **Set HD** (`.h<ancho>.webp|avif`), en este orden de prioridad:
    1. **Arte regenerado** en `art-src/hd/<misma ruta que en ../original/assets, cualquier extensión>` (p. ej. `art-src/hd/images/menuElements/menu.png`).
       Si conserva la proporción del original se usa con la misma composición; si es arte nuevo (16:9, panoramas 3:1…)
       sólo se acepta en pantallas *escénicas* (fondos, menú, mapa, historieta, ganaste/perdiste), que el juego dibuja
       con *cover* + punto focal sin depender de coordenadas dentro de la imagen. Variantes por ancho (≈960/1600/2560,
       nunca más que la fuente) en AVIF + WebP y una mini desenfocada para extender el fondo.
    2. **Super-resolución x2 con IA** para todo lo demás (sprites de Xa, enemigos, jefe, tilesets, objetos, HUD, botones,
       fuentes…): ESRGAN *medium* de UpscalerJS corriendo en Node con TensorFlow.js + WASM (`tools/upscale/esrgan.mjs`).
       El alfa se escala aparte (lanczos3) y los colores se "sangran" hacia lo transparente (sin halos); los tilesets se
       escalan tile por tile con bordes replicados (sin costuras) y las grillas de los atlas quedan exactamente x2.
       Resultados cacheados en `art-src/.cache` (no se commitea). Sin el modelo: lanczos3 + enfoque.
  - Audio: Opus/WebM (música 96 kb/s, efectos 64 kb/s) + MP3 de respaldo. Íconos PWA desde el cuadro de Xa.
  - `--force` rehace todo, `--only=clave1,clave2` sólo esas imágenes, `--no-ai` sin modelo.
- `scripts/build-data.mjs`: `assets/data/levelN.tmx` → `src/data/levels/levelN.json`; nombres/descripciones de `xa.exe`; métricas de fuentes → `src/data/meta.json`.

`public/assets/**`, `public/icons/**` y `src/data/**` **están commiteados**: Amplify no tiene ffmpeg, ni el modelo, ni la carpeta `original/`, así que `npm run build` sólo hace `tsc --noEmit && vite build`.

En el navegador se elige la variante según el tamaño real de la pantalla × devicePixelRatio (y AVIF si el navegador lo soporta);
las texturas se decodifican a `ImageBitmap`, se cargan por pantalla/nivel con barra de progreso y se liberan al cambiar de nivel.

## Pantalla completa, formatos y móviles

- **Sin barras negras**: la escala es `min(ancho/512, alto/384)` y la vista lógica se *extiende* en el eje que sobra
  (16:9 → 683×384, 19.5:9 → 832×384, 4:3 vertical → 512×683): en el juego se ve más mundo (cámara limitada a los bordes
  del nivel; niveles más chicos que la vista quedan centrados con el fondo extendido). Los menús dibujan el arte a sangre
  completa (*cover* con punto focal, recortando como mucho un porcentaje por pantalla; el resto, fondo desenfocado) y su
  interfaz en un panel 512×384 centrado; HUD y botones respetan las muescas (`env(safe-area-inset-*)`).
- Canvas a devicePixelRatio (tope 2 en teléfonos, 2,5 en escritorio) con presupuesto de píxeles según *Calidad*.
- **Teléfonos sólo en horizontal**: en vertical aparece "Gira tu celular" y el juego queda en pausa. Tablets y escritorio sin cambios.
- Primer toque en móvil: pantalla completa + `screen.orientation.lock('landscape')` donde existe (Android). iOS no lo
  permite en Safari: aviso de girar y *Compartir → Agregar a pantalla de inicio* (PWA a pantalla completa).
- **PWA**: `manifest.webmanifest` (horizontal, pantalla completa, íconos), `sw.js` generado en el build (shell precacheado,
  assets *cache-first*; tras la primera carga baja en segundo plano lo necesario para jugar sin conexión).

## Publicar en AWS Amplify Hosting

1. Conectar el repo en Amplify → "Monorepo" con raíz de app `xa/game` (o usar `amplify.yml`, que ya declara `appRoot: xa/game`, `npm ci`, `npm run build`, artefactos `dist`, caché de `node_modules`).
2. Versión de Node: 22 (Build settings → Build image settings → Node 22; también está `.nvmrc`). No hace falta nada de Node 24.
3. Encabezados: `customHttp.yml` (caché larga e inmutable para `/assets/**` —las URLs llevan `?v=<hash>`— y `/static/**` de Vite; `index.html` y `sw.js` sin caché).
4. Regla de reescritura SPA (Rewrites and redirects):
   - Origen: `</^[^.]+$|\.(?!(css|gif|ico|jpg|jpeg|js|png|txt|svg|woff|woff2|ttf|map|json|webp|avif|webm|webmanifest|ogg|mp3|mp4)$)([^.]+$)/>`
   - Destino: `/index.html` — Tipo: `200 (Rewrite)`
5. (Opcional, a futuro) `VITE_API_URL` activa `src/core/api.ts` (rutas `/games/xa-cuatreros/save|results|leaderboard` de la API compartida). Hoy está desconectado: sin esa variable no se hace ninguna llamada y todo se guarda en `localStorage`.

## Estructura

| Carpeta | Qué hay |
|---|---|
| `scripts/` | `tmx.mjs` (lector de Tiled), `build-assets.mjs`, `build-data.mjs` |
| `tools/upscale/` | super-resolución ESRGAN (dependencias propias, sólo local) |
| `art-src/hd/` | arte regenerado en alta resolución (misma ruta que en `original/assets`) |
| `tests/` | pruebas de física en Node |
| `src/core/` | escenario a pantalla completa (`stage.ts`), texturas multi-resolución (`assets.ts`), controles táctiles (`touch.ts`), entrada, audio, pantalla completa/PWA (`platform.ts`), fuentes, guardado, pantallas con transiciones, API opcional |
| `src/game/` | `level.ts` (mapa y colisiones), `hero.ts` (Xa), `entities.ts` (enemigos, objetos, vacas, puertas, plataformas, jefe), `world.ts` (reglas, cámara, HUD), `tilecache.ts` (tiles pre-renderizados por bloques), `particles.ts` (pool de partículas), `sprites.ts` (cuadros de los atlas) |
| `src/screens/` | logos, carga, menú, opciones, ayuda, créditos, historia, mapa de niveles, presentación de nivel, juego/pausa, perdiste, ganaste |
| `src/data/` | generado: 16 niveles (un chunk por nivel, se descargan al jugarlos) y `meta.json` |
| `public/assets/` | generado: imágenes WebP/AVIF en varias resoluciones, Opus/WebM y MP3 |

## Qué es fiel y qué es reconstrucción

**Fiel (sale de los datos originales):** todo el arte, música y efectos; los 16 mapas (tiles, tiles sólidos/plataforma/escalera/mortales, posición y propiedades de cada objeto: vidas, velocidades, tiempos de disparo, recorridos, equipos); fondo, tileset y música de cada nivel (`pBackground`, `pMusic`; el punto de salvado del jefe cambia a `xa_boss`); textos de los carteles; nombres y descripciones de los niveles (del exe); flujo Batoví → Calcar → "Ingresando a la atmósfera" → menú → historia (5 páginas) → mapa → presentación → nivel; resolución lógica 512x384 y tiles de 32 px; controles (imagen de ayuda y carteles).

**Reconstruido (el motor `xa.exe` lo tenía compilado y no se ejecutó):**
- Física de Xa: velocidad 180 px/s, salto ≈ 3 tiles, doble salto ≈ +2,6 tiles (ver *Física y doble salto*). Ajustada para que los recorridos de los mapas funcionen; no es la constante original.
- Cuadros de animación: medidos de las imágenes (cajas de alfa) y asignados por nombre (`STAND`, `WALK`, `SHOT_RUN`, `CLIMB`, `ANDROID`, `DUCK_ROBOT`...). La correspondencia nombre→dibujo de algunos enemigos es una deducción.
- Comportamiento de cada tipo de enemigo a partir de sus propiedades y de los carteles: caminantes que giran en bordes, saltarines (pyVel/pyAccel), platillos con recorrido pxDelta/pDuration, torretas, minas que estallan en balas, guillotinas, robot piraña. El equipo (`pTeam` ≥ 2) se interpreta como "explota en balas al morir" (patrones `8_BULLETS`, `3_FALL`, `4_FALL`... cuyos nombres están en el exe).
- Jefe (MARCOX): 200 vidas en el dato, reequilibradas a 120; patrón de movimiento, saltos y ráfagas inventados; al morir entrega la llave de la última puerta (`BOSS_KEY`, dato).
- Puntaje (moneda 100, enemigo 200–300, vaca 1000), energía máxima 10 (la barra tiene 10 cuadros), daño (contacto 2, bala 1), 3 vidas iniciales y "game over" vuelve al mapa con 3 vidas.
- HUD: posición de cada pieza; posición de los niveles en el mapa (platillos rojos del dibujo, orden por el lugar que muestra cada nivel); aspecto de las plataformas móviles por nivel; orden de los glifos de las fuentes.
- Menú de noche (`menu_night`) entre las 20 y las 7 h; "Salir" vuelve a la pantalla de título (en la web no se cierra la ventana).
- No se usa: el "mega poder" (no aparece en ningún mapa; su gráfico se usa como explosión), cohetes (`VRocket`/`HRocket` no aparecen en los mapas), el benchmark y el modo "Récord" en línea.
