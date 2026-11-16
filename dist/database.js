import { DEFAULT_PLAYLISTS, migrateTrackV3 } from "./library-core.js";
export function openLibraryDatabase(name = "wcsl-music-desk") {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 3);
    request.onupgradeneeded = () => {
      const db = request.result,
        tx = request.transaction;
      if (!db.objectStoreNames.contains("tracks"))
        db.createObjectStore("tracks", { keyPath: "id" });
      if (!db.objectStoreNames.contains("audio"))
        db.createObjectStore("audio", { keyPath: "id" });
      if (!db.objectStoreNames.contains("playlists")) {
        const lists = db.createObjectStore("playlists", { keyPath: "id" });
        for (const list of DEFAULT_PLAYLISTS) lists.put(list);
      }
      // Una única transacción: si falla cualquier escritura, se revierte la migración.
      const cursor = tx.objectStore("tracks").openCursor();
      cursor.onsuccess = () => {
        const current = cursor.result;
        if (!current) return;
        const track = migrateTrackV3(current.value);
        // Compatibilidad con v1: conservar el Blob al separarlo de los metadatos.
        if (track.blob) {
          tx.objectStore("audio").put({ id: track.id, blob: track.blob });
          delete track.blob;
        }
        current.update(track);
        current.continue();
      };
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("Cierra otras pestañas de la app y vuelve a abrirla."));
  });
}
