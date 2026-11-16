# WCSL Music Desk · v0.3

Aplicación web con módulos ES y archivos estáticos en `dist/`, sin frameworks, librerías ni servicios externos. Interfaz oscura en español para preparar clases y sociales de West Coast Swing. Esta versión usa audio local: publicar el código o un paquete del equipo no sube los MP3 a Internet.

## Incluye

- Importación de archivos o carpetas, deduplicación por SHA-256, análisis automático opcional y cancelación tras el tema en curso. Ocho listas iniciales; se conservan las listas y los datos existentes.
- Velocidad de 80 % a 120 %, pasos de 1 %, botones −5 %, 100 % y +5 %, restablecer y BPM efectivo. Conservación del tono con las tres propiedades del navegador. Guardar la velocidad por canción; distintivo en la tabla. Atajos `[`, `]` y `\`, sin actuar en campos de texto.
- Crear, renombrar, borrar y duplicar listas; seleccionar varios temas; ordenar con flechas o arrastrar el asa con ratón o pantalla táctil. El arrastre funciona en «Orden de la lista». Resumen de número de temas, duración y rango de BPM; pertenencias editables desde la ficha de la canción.
- Cola de reproducción visible, independiente de las listas y los filtros. «＋ Cola» añade un tema; las casillas y «Añadir a cola» añaden varios al final, conservando el orden anterior. Se puede subir, bajar, reproducir o quitar una aparición. Admite repetir canciones y conserva la aparición actual al moverla. La cola es temporal: se vacía al recargar o cambiar de modo; nunca modifica listas guardadas. Disponible también en el reproductor del equipo y desde Directo.
- Reproducción continua o parada al terminar cada tema, repetir canción, volumen y búsqueda temporal. Espera configurable de 0 a 60 segundos entre canciones en reproducción continua, con cuenta atrás y cancelación. La preferencia se conserva; anterior/siguiente manuales avanzan inmediatamente. Sin mezclas ni aleatorio.
- Estilo principal y secundarios, etiquetas, notas, favoritos y búsqueda. Tempo experimental con Worker. Corrección específica de doble tempo reportado para Cool y Grow Up (estimaciones automáticas entre 170 y 220); conserva `rawBpm` y no cambia BPM manuales. No es una identificación discográfica ni una mejora general del detector.
- Publicación de `wcsl-datos.json` sin audio para compartir listas y metadatos con el equipo. Reproductor separado con carga de paquete y MP3, vista previa antes de reemplazar, pendientes por nombre de archivo y reutilización del audio disponible. La biblioteca de gestión se conserva aparte.
- Modo reproductor: controles de edición ocultos, guardas de escritura y PIN para salir. Permite seleccionar temas y modificar la cola temporal; la velocidad publicada solo se modifica durante la reproducción. El PIN de cuatro cifras se guarda con salt y SHA-256 y solo evita cambios accidentales; no sustituye una cuenta ni permisos de servidor.
- Pantalla activa opcional mientras suena la música, nueva solicitud al regresar a la pestaña, Media Session cuando el navegador la admite y modo Directo con controles grandes.
- Copia completa con audio y estimación previa del tamaño; restauración compatible con copias v1, v2 y v3. La copia conserva datos anteriores y fusiona membresías sin duplicados.
- Caché del shell mediante Service Worker para reabrir la app sin conexión después de la primera carga correcta. La música del equipo debe haberse cargado previamente en ese navegador. No incluye manifest, instalación PWA ni sincronización de cuentas.

## Datos y migración

IndexedDB `wcsl-music-desk` pasa de v2 a v3. Se conservan `tracks`, `audio` y `playlists`; se añade `settings` si no existe. Una única transacción de actualización normaliza `speed` (por defecto 1, rango 0.8–1.2; valores inválidos vuelven a 1). Conserva todos los campos originales, incluidos BPM, `rawBpm`, favoritos, etiquetas y notas. La migración v1 separa los blobs en `audio` sin perderlos. No se reinicia ni se borra la biblioteca.

El reproductor del equipo usa una base independiente `wcsl-music-desk-team` v3, con los mismos stores y sin listas iniciales. Los ajustes de modo, PIN, contador de publicaciones, pantalla activa y espera viven en `wcsl-music-desk-preferences` v1. Cambiar de modo no reemplaza los datos de gestión. Actualizar el paquete reemplaza todos los metadatos y listas **del equipo**, dentro de una transacción; retiene los blobs reutilizables. «Liberar espacio» pide confirmación y elimina únicamente audios no usados en sus listas.

Los datos dependen del navegador, perfil y origen. No cambies el dominio al actualizar. Cierra otras pestañas si se bloquea la actualización de IndexedDB. Conserva los originales y copias completas: borrar los datos del navegador elimina la biblioteca y el PIN.

## Formato `wcsl-share` v1

```json
{
  "format": "wcsl-share",
  "version": 1,
  "publicationVersion": 1,
  "publishedAt": "2026-11-16T12:00:00.000Z",
  "tracks": [],
  "playlists": []
}
```

Cada canción incluye exclusivamente `id`, `filename`, `title`, `artist`, `duration`, `bpm`, `genre`, `secondaryGenres`, `tags` y `speed`. Cada lista incluye identificador, nombre, descripción y `trackIds` en orden; el orden del array de listas es el orden publicado. `id` es el SHA-256 del audio. No se exportan audio, notas ni favoritos privados. `publicationVersion` aumenta en cada publicación desde ese navegador, independientemente de la versión del formato.

La exportación valida un límite inferior a 1 MB; si los textos o listas lo superan, avisa sin truncar datos. La prueba con 500 canciones y listas está por debajo del límite. Compartir el JSON y los MP3 por OneDrive/Drive requiere guardar los archivos allí manualmente; la app no accede a esas cuentas.

El emparejamiento da prioridad global al hash; después prueba nombre de archivo normalizado y duración ±2 segundos. Las coincidencias ambiguas se dejan pendientes. Una coincidencia por nombre conserva el ID publicado como referencia canónica. Al actualizar se reemplazan los metadatos publicados, incluidos BPM y velocidad; no se fusionan ni se recalculan BPM. Los pendientes conservan sus datos y se completan al cargar su audio.

## Cómo probar

1. Ejecuta `npm test`. Sirve `dist/` por HTTP en localhost o HTTPS; `file://` no sirve para módulos y Workers.
2. Abre una biblioteca existente v2: acepta gestión y comprueba canciones, audio, listas, BPM, favoritos, notas y etiquetas. La prueba adicional `tests/database.html`, servida desde la raíz del repositorio, comprueba v1/v2 → v3 con bases temporales aisladas y reapertura.
3. Reproduce una canción a 90 % y comprueba el BPM efectivo. Marca guardar, recarga y vuelve a reproducir. Prueba `[`, `]` y `\`; escribe esos caracteres en la búsqueda para comprobar que no afectan al reproductor.
4. Abre una lista y elige «Orden de la lista». Arrastra por el asa o usa flechas, recarga y comprueba el orden. Duplica la lista y marca/desmarca pertenencias desde la ficha.
5. Pulsa «Publicar para el equipo» y guarda `wcsl-datos.json`. En otro navegador o modo reproductor, define un PIN y carga el JSON. Revisa las listas y los nombres pendientes antes de aplicar; añade MP3 por selección múltiple o carpeta.
6. Publica cambios en gestión y carga el nuevo JSON mediante «Actualizar». Comprueba fecha y versión, reemplazo de listas y reutilización de audio. Añade solo los MP3 pendientes. Prueba salir con PIN incorrecto y correcto y verifica que la biblioteca de gestión sigue intacta.
7. En ambos modos, añade un tema con «＋ Cola». Marca varios temas y pulsa «Añadir a cola». Abre «Ver cola», cambia posiciones y añade una repetición: los temas anteriores y las listas guardadas conservan su orden. Reproduce una aparición y muévela; anterior/siguiente siguen esa posición, incluso si su hash aparece varias veces.
8. Configura los segundos entre canciones, activa continua y reproduce una cola. Comprueba cuenta atrás, parada al final y cancelación con el botón de reproducción. Cambia el orden durante la espera: al terminar se elige el siguiente tema según el nuevo orden. Desactiva continua para detener al terminar cada tema.
9. Abre Directo, cambia temporalmente velocidad y volumen, prueba anterior/siguiente y abre la cola. Activa pantalla activa, regresa a la pestaña y comprueba los controles multimedia cuando el dispositivo los admita.
10. Genera una copia completa tras revisar su estimación y restaura una copia v1/v2 en un navegador de prueba. Para probar sin conexión, espera el aviso de app guardada, carga audio, desconecta la red y recarga la misma URL.

## Verificación y limitaciones

- `npm test`: 42 pruebas, todas correctas. Incluye tempo, normalización, migración pura, velocidad y conservación del tono, orden, estadísticas, exportación, emparejamiento, reemplazo, PIN, caché offline, espera cancelable y cola con repeticiones.
- Chromium: migración real v1/v2 → v3 (2 correctas, 0 fallidas), publicación/descarga, vista previa, carga de pendientes, actualización con reutilización de audio, aislamiento de gestión/equipo, PIN, Directo, selección múltiple y cambios de orden en la cola. No se observaron errores de consola propios de la app en la comprobación final.
- Falta validación física en Safari/iOS y Firefox, arrastre táctil, audición del tono y reproducción con pantalla bloqueada. La compatibilidad de archivos, Media Session, Wake Lock y reproducción en segundo plano depende del navegador. Las pruebas sintéticas no garantizan la estimación del tempo de música real.
- La cuenta atrás usa el reloj real; en segundo plano el sistema puede retrasar el siguiente tema. El audio requiere almacenamiento disponible. El modo offline depende de que el navegador conserve el shell y los blobs, y de las condiciones de acceso del alojamiento. No se ha certificado el acceso sin red a través de la pantalla de inicio de sesión del alojamiento actual.
- Esta rama no cambia el dominio ni despliega producción. No incluye nube, cuentas, permisos de servidor, listas personales de otras personas, búsqueda con OpenAI ni aleatorio.

## Siguiente fase: acceso desde móviles sin importar MP3

Para escuchar toda la biblioteca desde otro móvil sin cargar archivos locales hace falta servir audio por Internet. Propuesta: conservar el origen actual de la app, R2 privado para MP3, D1 para datos y una API autenticada que compruebe permisos y entregue el audio. Ray gestionaría la biblioteca común; María Jesús podría escucharla y crear listas personales sin modificar la biblioteca ni las listas de Ray. Esa separación de permisos necesita servidor y cuentas, no el PIN local.

Los planes gratuitos tienen cuotas; el coste depende del tamaño de la biblioteca y del uso. No se han activado servicios, facturación ni credenciales. El streaming necesita conexión; el acceso sin red requiere guardar audio en el dispositivo. GitHub contiene código e historial, nunca MP3 ni claves.

## Desarrollo y publicación

Repositorio: https://github.com/RaymonBil/wcsl-music-desk. Rama `fase-1`, con primer commit exclusivamente de formato y commits separados por bloque. La configuración del alojamiento `.openai/hosting.json` no forma parte del repositorio público. Mantener el mismo origen para conservar la biblioteca existente.

## Publicar en tu cuenta de Cloudflare

La configuración `wrangler.json` sirve exclusivamente `dist/` con Workers Static Assets. No necesita compilación ni dependencias de la app. No contiene credenciales ni crea R2/D1. La publicación del código no sincroniza canciones ni listas entre dispositivos.

Desde Workers & Pages, conecta el repositorio `RaymonBil/wcsl-music-desk`, selecciona la rama `fase-1` (contiene v0.3), el nombre `wcsl-music-desk` y la raíz del repositorio. Usa `npm test` como comando de validación y `npx wrangler@4 deploy` como comando de despliegue. No selecciones main hasta incorporar la fase 1. Cloudflare debe mostrar la URL final antes de dar por concluida la publicación.

Alternativa desde un equipo con Node compatible con Wrangler: `npx wrangler@4 login` y después `npx wrangler@4 deploy`. El inicio de sesión se hace directamente con Cloudflare; no publiques tokens ni contraseñas en GitHub.

La nueva URL tiene otro origen y comienza con una biblioteca local vacía. Antes de trasladar tu uso, abre la dirección antigua y descarga una «Copia completa (con audio)»; en la nueva URL, elige gestión y restaura esa copia. Conserva la dirección antigua y los archivos originales hasta comprobar canciones, listas y reproducción. Para compartir audio por streaming habrá que añadir R2 privado, una API y permisos de cuenta: esta publicación estática todavía no proporciona esa función.
