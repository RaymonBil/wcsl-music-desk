# WCSL Music Desk · v0.2

Aplicación web de escritorio para organizar archivos de audio propios, sin dependencias ni API externa. Diseño oscuro WCS Levante.

## Incluye
- Importar varios archivos o una carpeta con subcarpetas (selector webkitdirectory), omitiendo duplicados SHA-256. Análisis automático activado por defecto, desactivable. Las operaciones de importación y análisis pueden detenerse al terminar el tema en curso.
- Ocho listas iniciales manuales: calentamiento, ejercicios, sociales en clase, sociales en eventos y cuatro listas de tempo. Crear, editar nombre y descripción, añadir temas individuales o selección múltiple, quitar de la lista y ordenar con flechas. Una canción puede estar en varias listas sin duplicar el audio.
- Reproducir una lista entera en su orden, con una cola estable independiente de cambios posteriores en filtros. Avance continuo o parada al acabar cada tema, volumen, búsqueda temporal y repetir tema. Sin mezclas.
- Estilo principal y varios secundarios editables, etiquetas, notas y favoritos. Buscar también por estilos secundarios.
- Tempo experimental con Worker y tres segmentos como máximo. Corrección específica de doble tempo reportado para títulos Cool y Grow Up: estimaciones automáticas entre 170 y 220 se dividen por dos; se conserva rawBpm. No se modifican BPM confirmados manualmente ni otros títulos. Es una corrección de pulso de baile basada en la información del usuario, no una verificación discográfica ni una mejora general del detector.
- Copia JSON completa v2 con canciones, fichas y listas. Recuperación compatible con v1 y v2; comprueba hash, conserva canciones existentes y fusiona membresías sin duplicados. Listas existentes conservan su nombre y descripción.

## Datos y migración
IndexedDB `wcsl-music-desk`, versión 2. Stores `tracks` (solo metadatos), `audio` (Blob por hash) y `playlists` (orden de identificadores). La actualización desde v1 mueve los blobs dentro de la transacción de upgrade, conservando todos los campos previos. No hay reset, borrado ni subida de música al publicar cambios. Consultar la biblioteca ya no carga todos los blobs.
Los datos siguen siendo locales a un navegador/perfil/origen. Para actualizar, recargar la dirección actual. Si hay bloqueo de versión, cerrar otras pestañas antiguas. Guardar originales y copias completas: borrar los datos del navegador elimina la biblioteca.

## Verificación
`npm test`: 17 pruebas de tempo sintético, silencio, audio breve, doble tempo reportado, protección de valores manuales, listas, orden, deduplicación y normalización del formato anterior.
QA en navegador: migración real de una biblioteca v1 de prueba conservando favorito, etiquetas y audio reproducible; creación y guardado de listas; selección y asignación; importación múltiple con análisis automático; recuperación de copia v1. El selector de carpeta usa la misma ruta de importación; la automatización del navegador no pudo seleccionar la carpeta y se comprobó la selección múltiple equivalente. Pendiente validar con carpetas reales del usuario y con su música.

## Próxima fase: nube y búsqueda asistida
No se ha activado IA ni contratado infraestructura.
- GitHub privado: código fuente e historial. No almacenar MP3 ni claves en el repositorio. Repositorio de código: https://github.com/RaymonBil/wcsl-music-desk. La biblioteca personal sigue siendo local al navegador; subir este código no migra canciones ni listas.
- Propuesta: Cloudflare D1 para canciones, listas y metadatos; R2 privado para audio. Mantener caché local para clases en una fase posterior. Autenticación obligatoria en API y audio; migración explícita con verificación de recuentos/hash y conservando la biblioteca local antes de cambiar el origen.
- Búsqueda asistida: pendiente decisión de credenciales de OpenAI. Buscar por título + artista + versión; mostrar fuentes y sugerencias editables (principal y secundarios WCS); no sobrescribir sin revisar ni enviar archivos de audio automáticamente. No se ha añadido un botón de IA simulado.
- Aleatorio y segundos de pausa entre temas: siguientes mejoras, aún sin implementar.

## Desarrollo y publicación
Archivos estáticos en `dist/`; servir por HTTP/HTTPS. `file://` no es adecuado para módulos/Workers. La configuración de Sites `.openai/hosting.json` se conserva solo en el proyecto de alojamiento original y no se incluye en este repositorio público. Se mantiene el mismo origen para preservar la biblioteca del usuario.
