# WCSL Music Desk · Fase 1 (control de velocidad)

Aplicación web de escritorio para organizar archivos de audio propios, sin dependencias ni API externa. Diseño oscuro WCS Levante.

## Incluye
- Importar varios archivos o una carpeta con subcarpetas (selector webkitdirectory), omitiendo duplicados SHA-256. Análisis automático activado por defecto, desactivable. Las operaciones de importación y análisis pueden detenerse al terminar el tema en curso.
- Ocho listas iniciales manuales: calentamiento, ejercicios, sociales en clase, sociales en eventos y cuatro listas de tempo. Crear, editar nombre y descripción, añadir temas individuales o selección múltiple, quitar de la lista y ordenar con flechas. Una canción puede estar en varias listas sin duplicar el audio.
- Reproducir una lista entera en su orden, con una cola estable independiente de cambios posteriores en filtros. Avance continuo o parada al acabar cada tema, volumen, búsqueda temporal y repetir tema. Sin mezclas.
- Estilo principal y varios secundarios editables, etiquetas, notas y favoritos. Buscar también por estilos secundarios.
- Tempo experimental con Worker y tres segmentos como máximo. Corrección específica de doble tempo reportado para títulos Cool y Grow Up: estimaciones automáticas entre 170 y 220 se dividen por dos; se conserva rawBpm. No se modifican BPM confirmados manualmente ni otros títulos. Es una corrección de pulso de baile basada en la información del usuario, no una verificación discográfica ni una mejora general del detector.
- Copia JSON completa v3 con canciones, fichas y listas. Recuperación compatible con v1, v2 y v3; comprueba hash, conserva canciones existentes y fusiona membresías sin duplicados. Listas existentes conservan su nombre y descripción.

## Datos y migración
IndexedDB `wcsl-music-desk`, versión 3. Stores `tracks` (solo metadatos), `audio` (Blob por hash) y `playlists` (orden de identificadores). La actualización desde v1 mueve los blobs dentro de la transacción de upgrade, conservando todos los campos previos. No hay reset, borrado ni subida de música al publicar cambios. Consultar la biblioteca ya no carga todos los blobs.
Los datos siguen siendo locales a un navegador/perfil/origen. Para actualizar, recargar la dirección actual. Si hay bloqueo de versión, cerrar otras pestañas antiguas. Guardar originales y copias completas: borrar los datos del navegador elimina la biblioteca.

## Verificación
`npm test`: 23 pruebas de tempo sintético, silencio, audio breve, doble tempo reportado, protección de valores manuales, listas, orden, deduplicación y normalización del formato anterior.
QA en navegador: migración real de una biblioteca v1 de prueba conservando favorito, etiquetas y audio reproducible; creación y guardado de listas; selección y asignación; importación múltiple con análisis automático; recuperación de copia v1. El selector de carpeta usa la misma ruta de importación; la automatización del navegador no pudo seleccionar la carpeta y se comprobó la selección múltiple equivalente. Pendiente validar con carpetas reales del usuario y con su música.

## Próxima fase: nube y búsqueda asistida
No se ha activado IA ni contratado infraestructura.
- GitHub privado: código fuente e historial. No almacenar MP3 ni claves en el repositorio. Repositorio de código: https://github.com/RaymonBil/wcsl-music-desk. La biblioteca personal sigue siendo local al navegador; subir este código no migra canciones ni listas.
- Propuesta: Cloudflare D1 para canciones, listas y metadatos; R2 privado para audio. Mantener caché local para clases en una fase posterior. Autenticación obligatoria en API y audio; migración explícita con verificación de recuentos/hash y conservando la biblioteca local antes de cambiar el origen.
- Búsqueda asistida: pendiente decisión de credenciales de OpenAI. Buscar por título + artista + versión; mostrar fuentes y sugerencias editables (principal y secundarios WCS); no sobrescribir sin revisar ni enviar archivos de audio automáticamente. No se ha añadido un botón de IA simulado.
- Aleatorio y segundos de pausa entre temas: siguientes mejoras, aún sin implementar.

## Desarrollo y publicación
Archivos estáticos en `dist/`; servir por HTTP/HTTPS. `file://` no es adecuado para módulos/Workers. La configuración de Sites `.openai/hosting.json` se conserva solo en el proyecto de alojamiento original y no se incluye en este repositorio público. Se mantiene el mismo origen para preservar la biblioteca del usuario.


## Fase 1: control de velocidad
- Deslizador 80–120 % con pasos de 1 %, atajos de −5/+5 puntos, 100 % y restablecer.
- `playbackRate` y `defaultPlaybackRate`, con `preservesPitch`, `mozPreservesPitch` y `webkitPreservesPitch` a true. El tono y la calidad finales dependen del soporte del navegador; no hay procesador externo ni garantía acústica para todos los formatos.
- BPM efectivo calculado, sin modificar el BPM original ni los filtros. Con 96 BPM al 90 %, se muestra `96 BPM → 86 BPM (90 %)`. Sin BPM, solo el porcentaje.
- Sin marcar la casilla, el ajuste es temporal. Al marcarla se guarda `speed` en la canción identificada por su hash; los cambios siguientes también se guardan. Al desmarcarla se guarda 1 para futuras reproducciones, sin cambiar la velocidad que está sonando. Al pasar de canción se carga siempre su propia preferencia (1 por defecto).
- La tabla marca `Guardada: 90 %` cuando hay una velocidad guardada distinta de 1. Restablecer con la casilla marcada guarda 1 y elimina esa marca.
- Migración IndexedDB 3 atómica: añade `speed` sin reescribir BPM, listas, IDs ni blobs. Las ocho listas que existen realmente en el repositorio se conservan; no se reinician listas ya existentes. Las copias v1/v2 sin speed adoptan 1; v3 conserva la preferencia. Restaurar una canción que ya existe sigue conservando su ficha actual.

### Probar localmente
1. Ejecutar `npm test` (solo Node, sin instalación de dependencias).
2. Servir la raíz del repositorio por HTTP, por ejemplo `python3 -m http.server 8000`.
3. Abrir `/dist/` para la aplicación y `/tests/database.html` para las pruebas reales de IndexedDB. Estas pruebas usan bases desechables con nombres únicos, sin tocar la biblioteca.
4. Reproducir un tema, ajustar al 90 % y marcar guardar. Recargar y reproducirlo: debe recuperar 90 %. Otro tema sin preferencia debe arrancar al 100 %.
5. Hacer una copia completa y restaurarla en un perfil de prueba vacío para comprobar audio, listas y speed. No borrar la biblioteca habitual para probar.

### Alcance de esta entrega
Se implementa la funcionalidad 1 que aparece en el mensaje recibido. Ese mensaje termina en «En la tabla, indica las canciones que tengan…»; se interpreta como una marca de velocidad guardada distinta de 100 %. No se presupone el contenido de las funcionalidades que no llegaron. Se entrega en la rama `fase-1` y mediante PR hacia main, sin despliegue automático ni cambios en la biblioteca de producción.
