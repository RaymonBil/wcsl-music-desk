export async function prepareOfflineShell(status) {
  if (!("serviceWorker" in navigator) || !window.isSecureContext) {
    status.textContent =
      "Sin conexión: este navegador no permite guardar la app";
    return;
  }
  try {
    const registration = await navigator.serviceWorker.register("./sw.js", {
      scope: "./",
    });
    await navigator.serviceWorker.ready;
    const show = () => {
      status.textContent = navigator.onLine
        ? "App guardada para usar sin conexión en este navegador"
        : "Sin conexión · usando los datos de este dispositivo";
    };
    show();
    window.addEventListener("online", show);
    window.addEventListener("offline", show);
    registration.update().catch(() => {});
  } catch {
    status.textContent =
      "No se ha podido guardar la app para abrirla sin conexión";
  }
}
