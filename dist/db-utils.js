export function readStore(db, name) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, "readonly");
    const request = tx.objectStore(name).getAll();
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
  });
}
export function writeStores(db, names, callback) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, "readwrite");
    try {
      callback(tx);
    } catch (error) {
      tx.abort();
      reject(error);
      return;
    }
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () =>
      reject(tx.error || new Error("Operación interrumpida"));
  });
}
export async function getSetting(db, key) {
  return (await readStore(db, "settings")).find((item) => item.key === key)
    ?.value;
}
export async function putSetting(db, key, value) {
  await writeStores(db, ["settings"], (tx) =>
    tx.objectStore("settings").put({ key, value }),
  );
}

export function openPreferencesDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("wcsl-music-desk-preferences", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("settings", { keyPath: "key" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
