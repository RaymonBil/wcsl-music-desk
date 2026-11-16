import { createTeamController } from "./team-controls.js";
import { estimatedBackupBytes } from "./share-core.js";
import { describePlaylist, setupPointerReordering } from "./list-controls.js";
import { openLibraryDatabase } from "./database.js";
import { applyPlaybackSpeed } from "./playback.js";
import {
  DEFAULT_PLAYLISTS,
  addToPlaylist,
  removeFromPlaylist,
  moveInPlaylist,
  correctReportedDoubleTempo,
  cleanTrack,
  sanitizePlaylist,
  normalizeSpeed,
  shiftSpeed,
  speedDescription,
  supportsBackupVersion,
} from "./library-core.js";
let team;
const $ = (id) => document.getElementById(id);
const state = {
  tracks: [],
  view: "all",
  genre: "all",
  current: null,
  editing: null,
  busy: false,
  taps: [],
  urls: new Map(),
  playlists: [],
  playlistId: null,
  selected: new Set(),
  queue: [],
  cancel: false,
  playlistEditing: null,
  pendingAdd: [],
  speed: 1,
  mode: "choose",
};
const audio = $("audio");
audio.volume = 0.8;
let db,
  toastTimer,
  context,
  playToken = 0;
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const time = (s) =>
  Number.isFinite(s)
    ? `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`
    : "—";
function notify(message) {
  $("toast").textContent = message;
  $("toast").hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").hidden = true), 6000);
}
function progress(message) {
  $("progress").hidden = !message;
  $("progress").textContent = message || "";
}
function setBusy(b, cancellable = false) {
  state.busy = b;
  $("cancelOperation").hidden = !b || !cancellable;
  for (const id of [
    "importBtn",
    "folderBtn",
    "emptyImport",
    "analyzeAll",
    "backupBtn",
    "restoreBtn",
  ])
    $(id).disabled = b;
}
function transaction(mode, fn) {
  if (mode === "readwrite" && state.mode !== "edit")
    throw new Error("El modo reproductor no permite editar la biblioteca.");
  return new Promise((resolve, reject) => {
    const tx = db.transaction("tracks", mode);
    let result;
    try {
      result = fn(tx.objectStore("tracks"));
    } catch (e) {
      reject(e);
      return;
    }
    tx.oncomplete = () => resolve(result?.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Operación interrumpida"));
  });
}
function stores(names, mode, run) {
  if (mode === "readwrite" && state.mode !== "edit")
    throw new Error("El modo reproductor no permite editar la biblioteca.");
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, mode);
    let requests;
    try {
      requests = run(tx);
    } catch (e) {
      tx.abort();
      reject(e);
      return;
    }
    tx.oncomplete = () =>
      resolve(
        Array.isArray(requests)
          ? requests.map((r) => r?.result)
          : requests?.result,
      );
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error("Operación interrumpida"));
  });
}
const withoutBlob = ({ blob, ...t }) => t;
async function save(t) {
  return stores(["tracks", "audio"], "readwrite", (tx) => {
    if (t.blob) tx.objectStore("audio").put({ id: t.id, blob: t.blob });
    return tx.objectStore("tracks").put(withoutBlob(cleanTrack(t)));
  });
}
const load = () => transaction("readonly", (s) => s.getAll());
async function get(id) {
  const [meta, audioRecord] = await stores(
    ["tracks", "audio"],
    "readonly",
    (tx) => [tx.objectStore("tracks").get(id), tx.objectStore("audio").get(id)],
  );
  return meta
    ? { ...cleanTrack(meta), blob: audioRecord?.blob || meta.blob }
    : null;
}
const savePlaylist = (list) =>
  stores(["playlists"], "readwrite", (tx) =>
    tx.objectStore("playlists").put(list),
  );
async function reload() {
  state.tracks = (await load()).map(cleanTrack);
  state.playlists = await stores(["playlists"], "readonly", (tx) =>
    tx.objectStore("playlists").getAll(),
  );
  if (state.mode === "player") {
    const audioKeys = new Set(
      await stores(["audio"], "readonly", (tx) =>
        tx.objectStore("audio").getAllKeys(),
      ),
    );
    state.tracks = state.tracks.map((track) => ({
      ...track,
      ready: audioKeys.has(track.id),
    }));
  }
  const valid = new Set(state.tracks.map((t) => t.id));
  state.selected = new Set([...state.selected].filter((id) => valid.has(id)));
  render();
  await team?.refreshStatus();
}
function currentPlaylist() {
  return state.playlists.find((l) => l.id === state.playlistId);
}
function playlistTracks(list) {
  const lookup = new Map(state.tracks.map((t) => [t.id, t]));
  return (list?.trackIds || []).map((id) => lookup.get(id)).filter(Boolean);
}
function filtered() {
  const query = $("search").value.trim().toLocaleLowerCase();
  const tempo = $("tempoFilter").value;
  let out = state.tracks.filter((t) => {
    if (state.playlistId && !currentPlaylist()?.trackIds.includes(t.id))
      return false;
    if (state.view === "favorites" && !t.favorite) return false;
    if (state.view === "review" && t.bpmSource === "manual") return false;
    if (state.genre !== "all" && (t.genre || "Sin estilo") !== state.genre)
      return false;
    if (
      query &&
      !`${t.title} ${t.artist} ${t.genre} ${t.secondaryGenres.join(" ")} ${t.tags.join(" ")} ${t.notes}`
        .toLocaleLowerCase()
        .includes(query)
    )
      return false;
    if (tempo === "slow" && !(t.bpm && t.bpm < 90)) return false;
    if (tempo === "medium" && !(t.bpm >= 90 && t.bpm <= 110)) return false;
    if (tempo === "fast" && !(t.bpm > 110)) return false;
    if (tempo === "unknown" && t.bpm) return false;
    if (tempo === "custom") {
      const min = $("minBpm").value,
        max = $("maxBpm").value;
      if (!t.bpm || (min && t.bpm < +min) || (max && t.bpm > +max))
        return false;
    }
    return true;
  });
  const sort = $("sort").value;
  if (sort === "list" && currentPlaylist()) {
    const order = new Map(currentPlaylist().trackIds.map((id, i) => [id, i]));
    return out.sort((a, b) => order.get(a.id) - order.get(b.id));
  }
  return out.sort((a, b) =>
    sort === "bpm"
      ? (a.bpm || 9999) - (b.bpm || 9999)
      : sort === "recent"
        ? b.added - a.added
        : String(a[sort] || "").localeCompare(String(b[sort] || ""), "es"),
  );
}
function render() {
  const list = filtered();
  renderPlaylists();
  renderSelection(list);
  const genres = [
    ...new Set(state.tracks.map((t) => t.genre || "Sin estilo")),
  ].sort((a, b) => a.localeCompare(b, "es"));
  if (state.genre !== "all" && !genres.includes(state.genre)) {
    state.genre = "all";
    return render();
  }
  $("genreTabs").innerHTML = ["all", ...genres]
    .map(
      (g) =>
        `<button data-genre="${esc(g)}" class="${state.genre === g ? "active" : ""}" aria-pressed="${state.genre === g}">${g === "all" ? "Todos los estilos" : esc(g)}</button>`,
    )
    .join("");
  $("total").textContent = $("statTracks").textContent = state.tracks.length;
  $("favtotal").textContent = state.tracks.filter((t) => t.favorite).length;
  $("reviewtotal").textContent = state.tracks.filter(
    (t) => t.bpmSource !== "manual",
  ).length;
  $("statTime").textContent =
    `${Math.round(state.tracks.reduce((s, t) => s + (t.duration || 0), 0) / 60)} min`;
  $("statBpm").textContent = state.tracks.filter((t) => t.bpm).length;
  $("resultCount").textContent =
    `${list.length} tema${list.length === 1 ? "" : "s"}`;
  $("viewTitle").innerHTML = state.playlistId
    ? "Tu selección musical<span>.</span>"
    : {
        all: "Tu biblioteca musical",
        favorites: "Tus temas favoritos",
        review: "Afina el tempo",
      }[state.view] + "<span>.</span>";
  $("empty").hidden = state.tracks.length > 0;
  $("noResults").hidden =
    (!state.tracks.length && !state.playlistId) || list.length > 0;
  if (state.playlistId) {
    $("noResults").querySelector("h3").textContent = currentPlaylist()?.trackIds
      .length
      ? "No hay temas con estos filtros"
      : "Esta lista aún no tiene canciones";
    $("noResults").querySelector("p").textContent = currentPlaylist()?.trackIds
      .length
      ? "Prueba otro estilo, velocidad o búsqueda."
      : "Pulsa «Añadir temas» para elegir canciones de tu biblioteca.";
  } else {
    $("noResults").querySelector("h3").textContent =
      "No hay temas con estos filtros";
    $("noResults").querySelector("p").textContent =
      "Prueba otro estilo, velocidad o búsqueda.";
  }
  $("tracks").innerHTML = list
    .map(
      (t) =>
        `<tr data-track="${t.id}" class="${state.current === t.id ? "playing" : ""}"><td class="row-select edit-only"><input type="checkbox" data-select="${t.id}" ${state.selected.has(t.id) ? "checked" : ""} aria-label="Seleccionar ${esc(t.title)}"></td><td class="small-col"><button class="row-play" ${state.mode === "player" && !t.ready ? "disabled" : ""} data-action="play" data-id="${t.id}" aria-label="Reproducir ${esc(t.title)}">${state.current === t.id && !audio.paused ? "Ⅱ" : "▶"}</button></td><td><strong class="track-title" title="${esc(t.title)}">${esc(t.title)}</strong><span class="track-artist">${esc(t.artist || "Artista sin indicar")}</span>${state.mode === "player" && !t.ready ? `<small class="pending-track">Pendiente: ${esc(t.filename)}</small>` : ""}</td><td><span class="genre-pill">${esc(t.genre || "Sin estilo")}</span><span class="secondary-genres">${esc(t.secondaryGenres.join(" · "))}</span></td><td><b class="bpm-badge">${t.bpm || "—"}</b>${normalizeSpeed(t.speed) !== 1 ? `<span class="saved-speed" title="Velocidad guardada para esta canción">Guardada: ${Math.round(t.speed * 100)} %</span>` : ""}${t.bpmSource === "auto" ? `<span class="review">${t.bpmCorrection ? "Pulso ÷2 · revisar" : "Estimado · revisar"}</span>` : t.bpmSource === "failed" ? '<span class="review">Anotar manualmente</span>' : ""}</td><td class="muted">${time(t.duration)}</td><td>${t.tags
          .slice(0, 3)
          .map((tag) => `<span class="tag">${esc(tag)}</span>`)
          .join(
            "",
          )}${t.tags.length > 3 ? ` <span class="muted">+${t.tags.length - 3}</span>` : ""}</td><td class="edit-only"><div class="row-actions">${state.playlistId ? `<button type="button" class="drag-handle" data-drag="${t.id}" aria-label="Arrastrar ${esc(t.title)} para reordenar" ${$("sort").value !== "list" ? "disabled" : ""}>⠿</button><div class="row-move"><button data-id="${t.id}" data-action="up" title="Subir en la lista" aria-label="Subir ${esc(t.title)}">↑</button><button data-id="${t.id}" data-action="down" title="Bajar en la lista" aria-label="Bajar ${esc(t.title)}">↓</button></div>` : ""}<button class="icon-button favorite ${t.favorite ? "on" : ""}" data-id="${t.id}" data-action="favorite" aria-label="${t.favorite ? "Quitar de" : "Añadir a"} favoritos" aria-pressed="${t.favorite}">${t.favorite ? "♥" : "♡"}</button><button class="secondary" data-id="${t.id}" data-action="add" aria-label="Añadir ${esc(t.title)} a lista">＋ Lista</button><button class="secondary" data-id="${t.id}" data-action="edit">Editar</button><button class="icon-button" data-id="${t.id}" data-action="analyze" title="Analizar BPM" aria-label="Analizar BPM">⌁</button></div></td></tr>`,
    )
    .join("");
  $("prev").disabled =
    $("next").disabled =
    $("playPause").disabled =
      !state.tracks.length;
  renderSpeed();
  if (state.current) {
    const t = state.tracks.find((t) => t.id === state.current);
    if (t) {
      $("nowTitle").textContent = t.title;
      $("nowArtist").textContent = t.artist || "Artista sin indicar";
      $("nowBpm").textContent = speedDescription(t.bpm, state.speed);
    }
  }
}
function resetFilters() {
  state.genre = "all";
  $("search").value = "";
  $("tempoFilter").value = "all";
  $("customRange").hidden = true;
  render();
}
async function hash(file) {
  const data = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
async function decode(blob) {
  context ??= new AudioContext();
  return context.decodeAudioData(await blob.arrayBuffer());
}
function audioDuration(blob) {
  return new Promise((resolve) => {
    const a = new Audio(),
      url = URL.createObjectURL(blob);
    const finish = (value) => {
      clearTimeout(timer);
      a.removeAttribute("src");
      a.load();
      URL.revokeObjectURL(url);
      resolve(value);
    };
    const timer = setTimeout(() => finish(null), 6000);
    a.onloadedmetadata = () =>
      finish(Number.isFinite(a.duration) ? a.duration : null);
    a.onerror = () => finish(null);
    a.src = url;
  });
}
async function importFiles(files) {
  if (state.mode !== "edit") return;
  if (state.busy) return;
  setBusy(true, true);
  let count = 0,
    duplicates = 0,
    errors = 0;
  const addedIds = [];
  state.cancel = false;
  try {
    for (const file of files) {
      if (state.cancel) break;
      if (
        !file.type.startsWith("audio/") &&
        !/\.(mp3|wav|flac|m4a|ogg|aac|aiff|opus)$/i.test(file.name)
      ) {
        errors++;
        continue;
      }
      progress(
        `Importando ${count + duplicates + errors + 1}/${files.length}: ${file.name}`,
      );
      try {
        const id = await hash(file);
        if (state.tracks.some((t) => t.id === id)) {
          duplicates++;
          continue;
        }
        const duration = await audioDuration(file);
        if (!duration) {
          errors++;
          continue;
        }
        const parts = file.name.replace(/\.[^.]+$/, "").split(" - ");
        const artist = parts.length > 1 ? parts.shift() : "";
        const t = {
          id,
          title: parts.join(" - "),
          artist,
          genre: "",
          tags: [],
          notes: "",
          bpm: null,
          bpmSource: "none",
          duration,
          favorite: false,
          added: Date.now() + count,
          filename: file.name,
          blob: file,
        };
        await save(t);
        state.tracks.push(cleanTrack(withoutBlob(t)));
        addedIds.push(id);
        count++;
        render();
      } catch (e) {
        errors++;
        if (e.name === "QuotaExceededError") {
          notify(
            "No queda espacio en el navegador. Haz una copia de seguridad y libera espacio.",
          );
          break;
        }
      }
    }
    notify(
      `${count} canciones añadidas${duplicates ? ` · ${duplicates} duplicadas omitidas` : ""}${errors ? ` · ${errors} archivos no importados (formato, espacio o lectura)` : ""}.`,
    );
    navigator.storage?.persist?.().catch(() => {});
    if ($("autoAnalyze").checked && !state.cancel && addedIds.length) {
      let failed = 0;
      for (let i = 0; i < addedIds.length; i++) {
        if (state.cancel) break;
        progress(
          `Analizando las nuevas canciones ${i + 1}/${addedIds.length}…`,
        );
        try {
          await analyzeOne(addedIds[i]);
        } catch {
          failed++;
        }
        await reload();
      }
      notify(
        `${count} canciones importadas. ${state.cancel ? "Análisis detenido." : failed ? `${failed} análisis no completados.` : "Análisis terminado; revisa los BPM estimados."}`,
      );
    }
  } finally {
    progress("");
    setBusy(false);
    $("files").value = "";
    $("folderFiles").value = "";
    await reload();
  }
}
async function play(id, queue = null) {
  const token = ++playToken;
  if (queue) state.queue = [...queue];
  try {
    if (state.current === id && !queue) {
      if (audio.paused) await audio.play();
      else audio.pause();
      return;
    }
    const t = await get(id);
    if (token !== playToken) return;
    if (!t?.blob) throw new Error("Falta el archivo de audio.");
    audio.pause();
    if (state.urls.has("current"))
      URL.revokeObjectURL(state.urls.get("current"));
    const url = URL.createObjectURL(t.blob);
    state.urls.set("current", url);
    audio.src = url;
    state.current = id;
    $("saveSpeed").checked =
      state.mode === "edit" && normalizeSpeed(t.speed) !== 1;
    setSpeed(t.speed);
    updateQueueInfo();
    render();
    await audio.play();
  } catch (e) {
    notify(`No se puede reproducir: ${e.message}`);
  }
}
function renderSpeed() {
  const track = state.tracks.find((t) => t.id === state.current),
    hasTrack = !!track;
  for (const id of [
    "speed",
    "speedMinus",
    "speedNormal",
    "speedPlus",
    "resetSpeed",
    "saveSpeed",
  ])
    $(id).disabled = !hasTrack;
  $("speed").value = Math.round(state.speed * 100);
  $("speedValue").textContent = `${Math.round(state.speed * 100)} %`;
  $("speed").setAttribute(
    "aria-valuetext",
    `${Math.round(state.speed * 100)} por ciento`,
  );
  if (track) $("nowBpm").textContent = speedDescription(track.bpm, state.speed);
  else $("nowBpm").textContent = "";
}
function setSpeed(value) {
  state.speed = applyPlaybackSpeed(audio, value);
  renderSpeed();
}
async function persistSpeed(id, value) {
  if (state.mode !== "edit") return;
  try {
    const speed = normalizeSpeed(value);
    await stores(["tracks"], "readwrite", (tx) => {
      const tracks = tx.objectStore("tracks"),
        request = tracks.get(id);
      request.onsuccess = () => {
        if (request.result) tracks.put({ ...request.result, speed });
      };
    });
    await reload();
  } catch {
    notify(
      "No se ha podido guardar la velocidad. El ajuste de reproducción sigue activo.",
    );
  }
}
function changeSpeed(value) {
  if (!state.current) return;
  setSpeed(value);
  if (state.mode === "edit" && $("saveSpeed").checked)
    persistSpeed(state.current, state.speed);
}
$("speed").oninput = () => {
  if (state.current) setSpeed(Number($("speed").value) / 100);
};
$("speed").onchange = () => {
  if (state.mode === "edit" && state.current && $("saveSpeed").checked)
    persistSpeed(state.current, state.speed);
};
$("speedMinus").onclick = () => changeSpeed(shiftSpeed(state.speed, -5));
$("speedPlus").onclick = () => changeSpeed(shiftSpeed(state.speed, 5));
$("speedNormal").onclick = $("resetSpeed").onclick = () => changeSpeed(1);
$("saveSpeed").onchange = () => {
  if (state.current)
    persistSpeed(state.current, $("saveSpeed").checked ? state.speed : 1);
};
// Volver a aplicar el ajuste si el navegador reinicia la tasa al cargar el audio.
audio.onloadedmetadata = () => {
  if (state.current) applyPlaybackSpeed(audio, state.speed);
};
function updateQueueInfo() {
  const index = state.queue.indexOf(state.current);
  $("queueInfo").textContent =
    index >= 0 ? `${index + 1} / ${state.queue.length}` : "";
}
function advance(direction, automatic = false) {
  if (automatic && !$("continuous").checked) return;
  const ids = state.queue.length
    ? state.queue
    : filtered()
        .filter((track) => state.mode !== "player" || track.ready)
        .map((t) => t.id);
  if (!ids.length) return;
  const index = ids.indexOf(state.current),
    next = index < 0 ? 0 : index + direction;
  if (automatic && next >= ids.length) return;
  play(ids[(next + ids.length) % ids.length]);
}
function runTempo(samples, rate) {
  return new Promise((resolve, reject) => {
    const worker = new Worker("tempo-worker.js", { type: "module" });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error("El análisis ha tardado demasiado."));
    }, 45000);
    const finish = () => {
      clearTimeout(timer);
      worker.terminate();
    };
    worker.onmessage = (e) => {
      finish();
      e.data.error ? reject(new Error(e.data.error)) : resolve(e.data.result);
    };
    worker.onerror = (e) => {
      finish();
      reject(new Error(e.message));
    };
    worker.postMessage({ samples, rate }, [samples.buffer]);
  });
}
async function analyzeOne(id) {
  const t = await get(id);
  if (!t) return;
  let buffer;
  try {
    buffer = await decode(t.blob);
  } catch {
    t.bpmSource = "failed";
    await save(t);
    return;
  }
  // Three separated segments, no more than 90 seconds total; decimate for efficient analysis.
  const seconds = Math.min(30, buffer.duration);
  const stride = Math.max(1, Math.floor(buffer.sampleRate / 11025));
  const rate = buffer.sampleRate / stride;
  const segments = [];
  for (const start of new Set([
    0,
    Math.max(0, buffer.duration / 2 - seconds / 2),
    Math.max(0, buffer.duration - seconds),
  ])) {
    const length = Math.floor(seconds * rate),
      mono = new Float32Array(length);
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++)
        mono[i] +=
          (data[Math.floor(start * buffer.sampleRate) + i * stride] || 0) /
          buffer.numberOfChannels;
    }
    const result = await runTempo(mono, rate);
    if (result) segments.push(result);
  }
  // Preserve user edits and deletion that happened while the worker ran.
  const fresh = await get(id);
  if (!fresh || fresh.bpmSource === "manual") return;
  if (!segments.length) {
    fresh.bpmSource = "failed";
  } else {
    segments.sort((a, b) => b.strength - a.strength);
    const picked = segments[0];
    fresh.bpm = picked.bpm;
    fresh.rawBpm = picked.bpm;
    delete fresh.bpmCorrection;
    delete fresh.bpmCorrectionVersion;
    fresh.bpmSource = "auto";
    fresh.tempoStrength = picked.strength;
  }
  await save(correctReportedDoubleTempo(fresh));
}
async function analyze(ids) {
  if (state.mode !== "edit") return;
  if (state.busy) return;
  setBusy(true, true);
  state.cancel = false;
  let errors = 0;
  try {
    for (let i = 0; i < ids.length; i++) {
      if (state.cancel) break;
      const t = state.tracks.find((t) => t.id === ids[i]);
      progress(`Analizando BPM ${i + 1}/${ids.length}: ${t?.title || ""}`);
      try {
        await analyzeOne(ids[i]);
      } catch {
        errors++;
      }
      await reload();
    }
    notify(
      ids.length
        ? `Análisis terminado. Revisa los BPM estimados.${errors ? ` ${errors} análisis no completados.` : ""}`
        : "No hay canciones pendientes de análisis.",
    );
  } finally {
    setBusy(false);
    progress("");
  }
}
function openEditor(id) {
  if (state.mode !== "edit") return;
  const t = state.tracks.find((t) => t.id === id);
  if (!t) return;
  state.editing = id;
  state.taps = [];
  $("tapHint").textContent = "Marca al menos 4 pulsos";
  $("editTitle").value = t.title;
  $("editArtist").value = t.artist;
  $("editGenre").value = t.genre;
  $("editSecondary").value = t.secondaryGenres.join(", ");
  $("tempoOrigin").textContent = t.rawBpm
    ? `Medición original: ${t.rawBpm} BPM${t.bpmCorrection ? " · " + t.bpmCorrection : ""}`
    : "";
  $("editBpm").value = t.bpm || "";
  $("editTags").value = t.tags.join(", ");
  $("editNotes").value = t.notes;
  $("editMembership").innerHTML = state.playlists
    .map(
      (list) =>
        `<label><input type="checkbox" data-membership="${esc(list.id)}" ${list.trackIds.includes(id) ? "checked" : ""}> ${esc(list.name)}</label>`,
    )
    .join("");
  $("editor").showModal();
}
$("editForm").onsubmit = async (e) => {
  e.preventDefault();
  try {
    const t = await get(state.editing);
    if (!t) return;
    const raw = $("editBpm").value;
    t.title = $("editTitle").value.trim() || t.filename;
    t.artist = $("editArtist").value.trim();
    t.genre = $("editGenre").value.trim();
    t.secondaryGenres = [
      ...new Set(
        $("editSecondary")
          .value.split(",")
          .map((x) => x.trim())
          .filter(Boolean),
      ),
    ];
    t.bpm = raw ? Number(raw) : null;
    t.bpmSource = t.bpm ? "manual" : "none";
    if (!t.bpm) {
      delete t.bpmCorrection;
      delete t.bpmCorrectionVersion;
      delete t.rawBpm;
    }
    t.tags = [
      ...new Set(
        $("editTags")
          .value.split(",")
          .map((x) => x.trim())
          .filter(Boolean),
      ),
    ];
    t.notes = $("editNotes").value.trim();
    const memberships = new Set(
      [...$("editMembership").querySelectorAll("input:checked")].map(
        (input) => input.dataset.membership,
      ),
    );
    await stores(["tracks", "audio", "playlists"], "readwrite", (tx) => {
      tx.objectStore("tracks").put(withoutBlob(cleanTrack(t)));
      for (const list of state.playlists) {
        tx.objectStore("playlists").put(
          memberships.has(list.id)
            ? addToPlaylist(list, [t.id])
            : removeFromPlaylist(list, [t.id]),
        );
      }
    });
    $("editor").close();
    await reload();
    notify("Cambios guardados.");
  } catch (e) {
    notify("No se han podido guardar los cambios.");
  }
};
$("deleteTrack").onclick = async () => {
  if (state.busy) {
    notify("Espera a que termine la operación en curso.");
    return;
  }
  const t = state.tracks.find((t) => t.id === state.editing);
  if (
    !confirm(
      `¿Eliminar «${t.title}» de esta biblioteca? El archivo original se conserva.`,
    )
  )
    return;
  try {
    await stores(["tracks", "audio", "playlists"], "readwrite", (tx) => {
      tx.objectStore("tracks").delete(t.id);
      tx.objectStore("audio").delete(t.id);
      for (const list of state.playlists)
        tx.objectStore("playlists").put(removeFromPlaylist(list, [t.id]));
    });
    state.queue = state.queue.filter((id) => id !== t.id);
    if (state.current === t.id) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
      state.current = null;
      $("saveSpeed").checked = false;
      setSpeed(1);
      $("nowTitle").textContent = "Elige una canción";
      $("nowArtist").textContent = "Tu música, lista para la clase";
      $("nowBpm").textContent = "";
    }
    await reload();
    $("editor").close();
  } catch {
    notify("No se ha podido eliminar la canción.");
  }
};
$("half").onclick = () => {
  if (+$("editBpm").value >= 40)
    $("editBpm").value = Math.round((+$("editBpm").value / 2) * 10) / 10;
};
$("double").onclick = () => {
  if (+$("editBpm").value && +$("editBpm").value <= 200)
    $("editBpm").value = Math.round(+$("editBpm").value * 2 * 10) / 10;
};
$("tap").onclick = () => {
  const now = performance.now();
  if (state.taps.length && now - state.taps.at(-1) > 2500) state.taps = [];
  state.taps.push(now);
  if (state.taps.length > 12) state.taps.shift();
  if (state.taps.length >= 4) {
    const bpm = (60000 * (state.taps.length - 1)) / (now - state.taps[0]);
    if (bpm >= 20 && bpm <= 400) $("editBpm").value = Math.round(bpm * 10) / 10;
    $("tapHint").textContent = `${state.taps.length} pulsos · sigue marcando`;
  } else $("tapHint").textContent = `${state.taps.length}/4 pulsos`;
};
function blobToData(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
async function backup() {
  if (state.mode !== "edit") return;
  if (state.busy) return;
  const audioRecords = await stores(["audio"], "readonly", (tx) =>
    tx.objectStore("audio").getAll(),
  );
  const estimated = estimatedBackupBytes(
    audioRecords,
    state.tracks,
    state.playlists,
  );
  if (
    !confirm(
      `Copia completa con audio: tamaño estimado ${(estimated / 1024 / 1024).toFixed(1)} MB. Puede requerir bastante memoria. ¿Generarla?`,
    )
  )
    return;
  if (state.busy) return;
  setBusy(true);
  try {
    const records = [];
    for (let i = 0; i < state.tracks.length; i++) {
      progress(`Preparando copia ${i + 1}/${state.tracks.length}…`);
      const t = await get(state.tracks[i].id);
      records.push({ ...withoutBlob(t), audio: await blobToData(t.blob) });
    }
    const blob = new Blob(
      [
        JSON.stringify({
          format: "wcsl-music-desk",
          version: 3,
          playlists: state.playlists,
          created: new Date().toISOString(),
          tracks: records,
        }),
      ],
      { type: "application/json" },
    );
    const a = document.createElement("a"),
      url = URL.createObjectURL(blob);
    a.href = url;
    a.download = `WCSL-copia-completa-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    notify("Copia preparada. Comprueba que la descarga se haya guardado.");
  } catch {
    notify(
      "No se ha podido crear la copia. Puede superar la memoria disponible.",
    );
  } finally {
    setBusy(false);
    progress("");
  }
}
async function restore(file) {
  if (state.mode !== "edit") return;
  if (!file || state.busy) return;
  setBusy(true);
  let count = 0,
    skipped = 0;
  try {
    const data = JSON.parse(await file.text());
    if (
      data.format !== "wcsl-music-desk" ||
      !supportsBackupVersion(data.version) ||
      !Array.isArray(data.tracks)
    )
      throw new Error("No es una copia compatible.");
    for (const record of data.tracks) {
      progress(`Recuperando ${count + skipped + 1}/${data.tracks.length}…`);
      if (typeof record.audio !== "string" || !record.audio.startsWith("data:"))
        throw new Error("La copia contiene un audio no válido.");
      const response = await fetch(record.audio);
      const blob = await response.blob();
      const id = await hash(blob);
      if (id !== record.id)
        throw new Error("La copia contiene un archivo dañado.");
      if (state.tracks.some((t) => t.id === id)) {
        skipped++;
        continue;
      }
      const t = {
        id,
        title: String(record.title || "Sin título").slice(0, 200),
        artist: String(record.artist || "").slice(0, 200),
        speed: normalizeSpeed(record.speed),
        genre: String(record.genre || "").slice(0, 60),
        secondaryGenres: Array.isArray(record.secondaryGenres)
          ? record.secondaryGenres
              .map((x) => String(x).slice(0, 60))
              .slice(0, 20)
          : [],
        rawBpm: Number(record.rawBpm) || null,
        bpmCorrectionVersion: record.bpmCorrectionVersion === 1 ? 1 : null,
        bpmCorrection: String(record.bpmCorrection || "").slice(0, 100),
        tags: Array.isArray(record.tags)
          ? record.tags.map(String).slice(0, 30)
          : [],
        notes: String(record.notes || "").slice(0, 2000),
        bpm:
          Number(record.bpm) >= 20 && Number(record.bpm) <= 400
            ? Number(record.bpm)
            : null,
        bpmSource: ["auto", "manual", "none", "failed"].includes(
          record.bpmSource,
        )
          ? record.bpmSource
          : "none",
        duration: Number(record.duration) || null,
        favorite: !!record.favorite,
        added: Number(record.added) || Date.now(),
        filename: String(record.filename || record.title || "audio"),
        blob,
      };
      await save(correctReportedDoubleTempo(t));
      state.tracks.push(cleanTrack(withoutBlob(t)));
      count++;
    }
    if (data.version >= 2 && Array.isArray(data.playlists)) {
      for (const record of data.playlists) {
        const list = sanitizePlaylist(record);
        if (!list?.id) continue;
        const existing = state.playlists.find((x) => x.id === list.id);
        await savePlaylist(
          existing ? addToPlaylist(existing, list.trackIds) : list,
        );
      }
    }
    notify(
      `${count} canciones recuperadas · ${skipped} existentes conservadas.`,
    );
  } catch (e) {
    notify(
      `Recuperadas ${count} canciones. ${e.message || "No se pudo completar la recuperación."}`,
    );
  } finally {
    await reload();
    setBusy(false);
    progress("");
    $("restoreFile").value = "";
  }
}
$("backupBtn").onclick = backup;
$("restoreBtn").onclick = () => $("restoreFile").click();
$("restoreFile").onchange = (e) => restore(e.target.files[0]);
$("importBtn").onclick = $("emptyImport").onclick = () => $("files").click();
$("files").onchange = (e) => importFiles([...e.target.files]);
$("folderBtn").onclick = () => $("folderFiles").click();
$("folderFiles").onchange = (e) => importFiles([...e.target.files]);
$("cancelOperation").onclick = () => {
  state.cancel = true;
  progress("Deteniendo al terminar el tema actual…");
};
$("genreTabs").onclick = (e) => {
  const b = e.target.closest("[data-genre]");
  if (b) {
    state.genre = b.dataset.genre;
    render();
  }
};
document.querySelectorAll("[data-view]").forEach(
  (b) =>
    (b.onclick = () => {
      state.playlistId = null;
      state.view = b.dataset.view;
      state.selected.clear();
      $("sort").value = "recent";
      document
        .querySelectorAll("[data-view]")
        .forEach((x) => x.classList.toggle("active", x === b));
      resetFilters();
    }),
);
$("tracks").onclick = async (e) => {
  const b = e.target.closest("[data-action]");
  if (!b) return;
  const id = b.dataset.id;
  try {
    if (b.dataset.action === "play")
      play(
        id,
        filtered()
          .filter((track) => state.mode !== "player" || track.ready)
          .map((t) => t.id),
      );
    if (b.dataset.action === "add") openAdd([id]);
    if (b.dataset.action === "up" || b.dataset.action === "down") {
      await savePlaylist(
        moveInPlaylist(
          currentPlaylist(),
          id,
          b.dataset.action === "up" ? -1 : 1,
        ),
      );
      $("sort").value = "list";
      await reload();
    }
    if (b.dataset.action === "edit") openEditor(id);
    if (b.dataset.action === "analyze") {
      const t = state.tracks.find((t) => t.id === id);
      if (t.bpmSource === "manual") {
        notify(
          "BPM confirmado manualmente. Borra el BPM en Editar para volver a analizarlo.",
        );
        return;
      }
      analyze([id]);
    }
    if (b.dataset.action === "favorite") {
      const t = await get(id);
      if (t) {
        t.favorite = !t.favorite;
        await save(t);
        await reload();
      }
    }
  } catch {
    notify("No se ha podido completar la operación.");
  }
};
for (const id of ["search", "tempoFilter", "sort", "minBpm", "maxBpm"])
  $(id).addEventListener("input", () => {
    $("customRange").hidden = $("tempoFilter").value !== "custom";
    render();
  });
$("resetFilters").onclick = $("clearEmpty").onclick = resetFilters;
$("analyzeAll").onclick = () =>
  analyze(state.tracks.filter((t) => !t.bpm).map((t) => t.id));
$("closeEditor").onclick = () => $("editor").close();
$("helpBtn").onclick = () => $("help").showModal();
$("closeHelp").onclick = $("gotIt").onclick = () => $("help").close();
$("playPause").onclick = () =>
  state.current
    ? play(state.current)
    : filtered()[0] &&
      play(
        filtered()[0].id,
        filtered()
          .filter((track) => state.mode !== "player" || track.ready)
          .map((t) => t.id),
      );
$("prev").onclick = () => advance(-1);
$("next").onclick = () => advance(1);
$("repeat").onclick = () => {
  audio.loop = !audio.loop;
  $("repeat").setAttribute("aria-pressed", String(audio.loop));
};
audio.onplay = () => {
  $("playPause").textContent = "Ⅱ";
  $("playPause").setAttribute("aria-label", "Pausar");
  render();
};
audio.onpause = () => {
  $("playPause").textContent = "▶";
  $("playPause").setAttribute("aria-label", "Reproducir");
  render();
};
audio.onended = () => advance(1, true);
audio.onerror = () => {
  if (state.current)
    notify(
      "El navegador no puede reproducir este archivo. Prueba con MP3 o WAV.",
    );
};
audio.ontimeupdate = () => {
  $("elapsed").textContent = time(audio.currentTime);
  $("duration").textContent = time(audio.duration || 0);
  $("seek").value = audio.duration
    ? (audio.currentTime / audio.duration) * 1000
    : 0;
};
$("seek").oninput = () => {
  if (Number.isFinite(audio.duration))
    audio.currentTime = ($("seek").value / 1000) * audio.duration;
};
$("volume").oninput = () => (audio.volume = +$("volume").value);
window.addEventListener("keydown", (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing || e.repeat) return;
  if (
    document.activeElement.closest(
      "input, textarea, select, button, [contenteditable=true]",
    ) ||
    document.querySelector("dialog[open]")
  )
    return;
  if (e.code === "Space") {
    e.preventDefault();
    $("playPause").click();
  }
  if (
    state.mode !== "player" &&
    state.current &&
    ["[", "]", "\\"].includes(e.key)
  ) {
    e.preventDefault();
    changeSpeed(
      e.key === "\\" ? 1 : shiftSpeed(state.speed, e.key === "[" ? -1 : 1),
    );
  }
});
const drop = $("dropzone");
for (const event of ["dragenter", "dragover"])
  drop.addEventListener(event, (e) => {
    e.preventDefault();
    drop.classList.add("dragging");
  });
drop.addEventListener("dragleave", () => drop.classList.remove("dragging"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("dragging");
  importFiles([...e.dataTransfer.files]);
});
window.addEventListener("dragover", (e) => e.preventDefault());
window.addEventListener("drop", (e) => e.preventDefault());
function renderPlaylists() {
  $("playlistNav").innerHTML = state.playlists
    .sort((a, b) => a.created - b.created)
    .map(
      (l) =>
        `<button data-playlist="${esc(l.id)}" class="${state.playlistId === l.id ? "active" : ""}" title="${esc(l.description)}"><span>${esc(l.name)}<small>${esc(describePlaylist(l, state.tracks))}</small></span></button>`,
    )
    .join("");
  const l = currentPlaylist();
  $("playlistHeader").hidden = !l;
  $("removeSelected").hidden = !l;
  if (l) {
    $("playlistTitle").textContent = l.name;
    $("playlistDescription").textContent = l.description;
    $("playlistSummary").textContent =
      `${describePlaylist(l, state.tracks)} · Orden manual`;
    $("playPlaylist").disabled = !playlistTracks(l).length;
  }
}
function renderSelection(visible) {
  $("selectedCount").textContent = `${state.selected.size} seleccionadas`;
  $("addSelected").disabled = $("removeSelected").disabled =
    !state.selected.size;
  $("selectAll").checked =
    visible.length > 0 && visible.every((t) => state.selected.has(t.id));
  $("selectAll").indeterminate =
    visible.some((t) => state.selected.has(t.id)) && !$("selectAll").checked;
}
function openPlaylist(id = null) {
  if (state.mode !== "edit") return;
  state.playlistEditing = id;
  const l = state.playlists.find((l) => l.id === id);
  $("playlistDialogTitle").textContent = l ? "Editar lista" : "Crear lista";
  $("playlistName").value = l?.name || "";
  $("playlistDesc").value = l?.description || "";
  $("deletePlaylist").hidden = !l;
  $("playlistDialog").showModal();
}
function openAdd(ids) {
  if (state.mode !== "edit") return;
  state.pendingAdd = [...ids];
  if (!ids.length) {
    notify("Selecciona primero una o varias canciones.");
    return;
  }
  $("addSummary").textContent =
    `Vas a añadir ${ids.length} ${ids.length === 1 ? "canción" : "canciones"}.`;
  $("targetPlaylist").innerHTML = state.playlists
    .map((l) => `<option value="${esc(l.id)}">${esc(l.name)}</option>`)
    .join("");
  $("addDialog").showModal();
}
$("playlistNav").onclick = (e) => {
  const b = e.target.closest("[data-playlist]");
  if (!b) return;
  state.playlistId = b.dataset.playlist;
  state.view = "all";
  state.selected.clear();
  document
    .querySelectorAll("[data-view]")
    .forEach((b) => b.classList.remove("active"));
  $("sort").value = "list";
  resetFilters();
};
$("newPlaylist").onclick = $("newPlaylistSide").onclick = () => openPlaylist();
$("editPlaylist").onclick = () => openPlaylist(state.playlistId);
$("closePlaylistDialog").onclick = () => $("playlistDialog").close();
$("playlistForm").onsubmit = async (e) => {
  e.preventDefault();
  try {
    const old = state.playlists.find((l) => l.id === state.playlistEditing);
    const name = $("playlistName").value.trim();
    if (!name) {
      $("playlistName").setCustomValidity("Escribe un nombre.");
      $("playlistName").reportValidity();
      return;
    }
    $("playlistName").setCustomValidity("");
    const list = {
      id: old?.id || crypto.randomUUID(),
      name,
      description: $("playlistDesc").value.trim(),
      trackIds: old?.trackIds || [],
      created: old?.created || Date.now(),
    };
    await savePlaylist(list);
    await reload();
    $("playlistDialog").close();
    if ($("addDialog").open) {
      $("targetPlaylist").innerHTML = state.playlists
        .map((l) => `<option value="${esc(l.id)}">${esc(l.name)}</option>`)
        .join("");
      $("targetPlaylist").value = list.id;
    }
    notify("Lista guardada.");
  } catch {
    notify("No se ha podido guardar la lista.");
  }
};
$("playlistName").oninput = () => $("playlistName").setCustomValidity("");
$("deletePlaylist").onclick = async () => {
  if (
    !confirm(
      "¿Eliminar esta lista? Las canciones se conservan en tu biblioteca.",
    )
  )
    return;
  try {
    await stores(["playlists"], "readwrite", (tx) =>
      tx.objectStore("playlists").delete(state.playlistEditing),
    );
    if (state.playlistId === state.playlistEditing) {
      state.playlistId = null;
      state.view = "all";
      $("sort").value = "recent";
    }
    await reload();
    $("playlistDialog").close();
  } catch {
    notify("No se ha podido eliminar la lista.");
  }
};
$("addToCurrent").onclick = () => {
  const destination = state.playlistId;
  state.playlistId = null;
  state.view = "all";
  state.selected.clear();
  $("sort").value = "recent";
  resetFilters();
  notify("Selecciona canciones y pulsa «Añadir a lista».");
  state.lastDestination = destination;
};
$("addSelected").onclick = () => {
  openAdd([...state.selected]);
  if (
    state.lastDestination &&
    state.playlists.some((l) => l.id === state.lastDestination)
  )
    $("targetPlaylist").value = state.lastDestination;
};
$("closeAddDialog").onclick = () => $("addDialog").close();
$("createFromPicker").onclick = () => openPlaylist();
$("confirmAdd").onclick = async () => {
  try {
    const list = state.playlists.find(
      (l) => l.id === $("targetPlaylist").value,
    );
    if (!list) {
      notify("Crea primero una lista.");
      return;
    }
    const previous = list.trackIds.length;
    const updated = addToPlaylist(list, state.pendingAdd);
    await savePlaylist(updated);
    await reload();
    $("addDialog").close();
    state.selected.clear();
    render();
    notify(
      `${updated.trackIds.length - previous} canciones añadidas a «${list.name}».`,
    );
  } catch {
    notify("No se han podido añadir las canciones.");
  }
};
$("removeSelected").onclick = async () => {
  try {
    const list = currentPlaylist();
    if (!list) return;
    await savePlaylist(removeFromPlaylist(list, [...state.selected]));
    state.selected.clear();
    await reload();
    notify("Canciones retiradas de la lista; siguen en la biblioteca.");
  } catch {
    notify("No se ha podido modificar la lista.");
  }
};
$("selectAll").onchange = () => {
  for (const t of filtered())
    $("selectAll").checked
      ? state.selected.add(t.id)
      : state.selected.delete(t.id);
  render();
};
$("clearSelection").onclick = () => {
  state.selected.clear();
  render();
};
$("tracks").onchange = (e) => {
  const id = e.target.dataset.select;
  if (!id) return;
  e.target.checked ? state.selected.add(id) : state.selected.delete(id);
  renderSelection(filtered());
};
$("playPlaylist").onclick = () => {
  const list = playlistTracks(currentPlaylist()).filter(
    (track) => state.mode !== "player" || track.ready,
  );
  if (list.length) {
    $("continuous").checked = true;
    play(
      list[0].id,
      list.map((t) => t.id),
    );
  }
};
$("duplicatePlaylist").onclick = async () => {
  const list = currentPlaylist();
  if (!list) return;
  try {
    await savePlaylist({
      ...list,
      id: crypto.randomUUID(),
      name: `Copia de ${list.name}`,
      trackIds: [...list.trackIds],
      created: Date.now(),
    });
    await reload();
    notify("Lista duplicada.");
  } catch {
    notify("No se ha podido duplicar la lista.");
  }
};
setupPointerReordering({
  container: $("tracks"),
  getPlaylist: currentPlaylist,
  canReorder: () =>
    state.mode !== "player" && !state.busy && $("sort").value === "list",
  save: savePlaylist,
  render: reload,
  notify,
});
async function init() {
  setBusy(true);
  try {
    db = await team.initialize(await openLibraryDatabase());
    db.onversionchange = () => {
      db.close();
      setBusy(true);
      progress("Hay una versión nueva. Recarga esta pestaña.");
    };
    await reload();
    let adjusted = 0;
    for (const t of state.mode === "edit" ? state.tracks : []) {
      const corrected = correctReportedDoubleTempo(t);
      if (corrected !== t) {
        await save(corrected);
        adjusted++;
      }
    }
    if (adjusted) {
      await reload();
      notify(
        `Pulso de baile ajustado en ${adjusted} temas reportados (÷2). El valor original se conserva en Editar.`,
      );
    }
    setBusy(false);
  } catch (e) {
    progress(
      "No se puede abrir el almacenamiento local. Comprueba los permisos del navegador y recarga la página.",
    );
    notify(e.message);
  }
}
async function activateDatabase(active) {
  db = active;
  playToken++;
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
  const url = state.urls.get("current");
  if (url) URL.revokeObjectURL(url);
  state.urls.clear();
  state.current = null;
  state.playlistId = null;
  state.selected.clear();
  state.queue = [];
  state.view = "all";
  state.speed = 1;
  $("saveSpeed").checked = false;
  $("nowTitle").textContent = "Elige una canción";
  $("nowArtist").textContent = "Tu música, lista para la clase";
  $("queueInfo").textContent = "";
  $("search").value = "";
  $("tempoFilter").value = "all";
  state.genre = "all";
  await reload();
}
for (const id of [
  "importBtn",
  "folderBtn",
  "emptyImport",
  "autoAnalyze",
  "analyzeAll",
  "backupBtn",
  "restoreBtn",
  "newPlaylist",
  "newPlaylistSide",
  "editPlaylist",
  "duplicatePlaylist",
  "addToCurrent",
  "selectionBar",
  "publishBtn",
]) {
  $(id).classList.add("edit-only");
}
$("autoAnalyze").closest("label").classList.add("edit-only");
$("saveSpeed").closest("label").classList.add("edit-only");
$("tracks")
  .closest("table")
  .querySelectorAll("thead th.check-col, thead th:last-child")
  .forEach((node) => node.classList.add("edit-only"));
document
  .querySelectorAll('[data-view="favorites"], [data-view="review"]')
  .forEach((node) => node.classList.add("edit-only"));
team = createTeamController({
  state,
  audio,
  notify,
  reload,
  activate: activateDatabase,
  hash,
  audioDuration,
  setBusy,
  progress,
});
init();
