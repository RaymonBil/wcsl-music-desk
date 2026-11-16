import { speedDescription } from "./library-core.js";
const $ = (id) => document.getElementById(id);

export function createLiveController({
  audio,
  state,
  notify,
  adjustSpeed,
  onWakeChanged,
}) {
  let wakeLock = null;
  let requesting = false;
  let enabled = false;
  let lastMetadata = "";
  const wanted = () =>
    enabled &&
    !audio.paused &&
    !audio.ended &&
    document.visibilityState === "visible";

  async function syncWakeLock() {
    if (!navigator.wakeLock?.request) {
      $("wakeLockStatus").textContent =
        "Pantalla activa: no disponible en este navegador";
      $("wakeLockToggle").disabled = true;
      return;
    }
    if (!wanted()) {
      const current = wakeLock;
      wakeLock = null;
      if (current) await current.release().catch(() => {});
      $("wakeLockStatus").textContent = enabled
        ? "Pantalla activa al reproducir"
        : "";
      return;
    }
    if (wakeLock || requesting) return;
    requesting = true;
    try {
      const lock = await navigator.wakeLock.request("screen");
      if (!wanted()) {
        await lock.release();
        return;
      }
      wakeLock = lock;
      $("wakeLockStatus").textContent = "Pantalla activa";
      lock.addEventListener("release", () => {
        if (wakeLock === lock) wakeLock = null;
        $("wakeLockStatus").textContent = enabled
          ? "Pantalla activa: volverá a solicitarse al regresar"
          : "";
      });
    } catch {
      $("wakeLockStatus").textContent =
        "El navegador no ha permitido mantener la pantalla activa";
    } finally {
      requesting = false;
    }
  }

  function update() {
    const track = state.tracks.find((item) => item.id === state.current);
    const index = state.queueIndex;
    const next = audio.loop
      ? track
      : state.tracks.find((item) => item.id === state.queue[index + 1]);
    $("directTitle").textContent =
      track?.title || "Elige una canción de una lista";
    $("directArtist").textContent = track?.artist || "";
    $("directBpm").textContent = track
      ? speedDescription(track.bpm, state.speed)
      : "100 %";
    $("directNext").textContent = next
      ? `Siguiente: ${next.title}`
      : "Fin de la lista";
    $("directPlay").textContent = audio.paused ? "▶ Reproducir" : "Ⅱ Pausar";
    $("directRepeat").setAttribute("aria-pressed", String(audio.loop));
    $("directRepeat").textContent = audio.loop
      ? "Repetir tema: sí"
      : "Repetir tema: no";
    $("directContinuous").checked = $("continuous").checked;
    $("directSpeed").value = Math.round(state.speed * 100);
    $("directVolume").value = audio.volume;
    for (const id of [
      "directPlay",
      "directPrev",
      "directNextBtn",
      "directSpeed",
      "directReset",
    ])
      $(id).disabled = !track;
    if ("mediaSession" in navigator) {
      try {
        const metadataKey = `${track?.id || ""}:${track?.title || ""}:${track?.artist || ""}`;
        if (metadataKey !== lastMetadata) {
          navigator.mediaSession.metadata =
            track && typeof MediaMetadata !== "undefined"
              ? new MediaMetadata({
                  title: track.title,
                  artist: track.artist || "WCS Levante",
                  album: "WCSL Music Desk",
                })
              : null;
          lastMetadata = metadataKey;
        }
        navigator.mediaSession.playbackState = !track
          ? "none"
          : audio.paused
            ? "paused"
            : "playing";
      } catch {
        /* API opcional: el reproductor web sigue funcionando. */
      }
    }
  }

  for (const [action, handler] of Object.entries({
    play: () => {
      if (audio.paused) $("playPause").click();
    },
    pause: () => audio.pause(),
    previoustrack: () => $("prev").click(),
    nexttrack: () => $("next").click(),
  })) {
    try {
      navigator.mediaSession?.setActionHandler(action, handler);
    } catch {
      /* Acción no admitida. */
    }
  }
  for (const event of ["play", "pause", "ended", "emptied"]) {
    audio.addEventListener(event, () => {
      update();
      syncWakeLock();
    });
  }
  audio.addEventListener("volumechange", update);
  document.addEventListener("visibilitychange", syncWakeLock);
  window.addEventListener("pagehide", () => {
    if (wakeLock) wakeLock.release().catch(() => {});
  });
  $("wakeLockToggle").onchange = async () => {
    enabled = $("wakeLockToggle").checked;
    syncWakeLock();
    try {
      await onWakeChanged(enabled);
    } catch {
      notify("No se ha podido guardar la preferencia de pantalla activa.");
    }
  };
  $("openDirect").onclick = () => {
    $("directView").hidden = false;
    document.body.classList.add("direct-mode");
    update();
    $("closeDirect").focus();
  };
  const close = () => {
    $("directView").hidden = true;
    document.body.classList.remove("direct-mode");
    $("openDirect").focus();
  };
  $("closeDirect").onclick = close;
  window.addEventListener("keydown", (event) => {
    if (
      event.key === "Escape" &&
      !$("directView").hidden &&
      !document.querySelector("dialog[open]")
    )
      close();
  });
  $("directPlay").onclick = () => $("playPause").click();
  $("directPrev").onclick = () => $("prev").click();
  $("directNextBtn").onclick = () => $("next").click();
  $("directRepeat").onclick = () => {
    $("repeat").click();
    update();
  };
  $("directContinuous").onchange = () => {
    $("continuous").checked = $("directContinuous").checked;
    update();
  };
  $("directSpeed").oninput = () =>
    adjustSpeed(Number($("directSpeed").value) / 100);
  $("directReset").onclick = () => adjustSpeed(1);
  $("directVolume").oninput = () => {
    audio.volume = Number($("directVolume").value);
    $("volume").value = audio.volume;
  };
  $("continuous").addEventListener("change", update);
  return {
    update,
    setWakePreference(value) {
      enabled = !!value;
      $("wakeLockToggle").checked = enabled;
      syncWakeLock();
    },
  };
}
