import { openLibraryDatabase } from "./database.js";
import {
  readStore,
  writeStores,
  getSetting,
  putSetting,
  openPreferencesDatabase,
} from "./db-utils.js";
import {
  createTeamPackage,
  validateTeamPackage,
  prepareTeamReplacement,
  matchTracks,
  unreferencedAudioIds,
  MAX_SHARE_BYTES,
} from "./share-core.js";
import { makePin, verifyPin } from "./pin-core.js";

const $ = (id) => document.getElementById(id);
const escape = (value) =>
  String(value || "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function downloadJson(value, filename) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function createTeamController({
  state,
  audio,
  notify,
  reload,
  activate,
  hash,
  audioDuration,
  setBusy,
  progress,
}) {
  let ownerDb;
  let preferencesDb;
  let teamDb;
  let config = {};
  let preview = null;
  let resolveChoice;
  let modeDialogPurpose = "initial";
  let operation = false;

  async function saveConfig() {
    await putSetting(preferencesDb, "app", config);
  }
  async function teamDatabase() {
    if (!teamDb) {
      teamDb = await openLibraryDatabase("wcsl-music-desk-team", {
        seedDefaults: false,
      });
      teamDb.onversionchange = () => teamDb.close();
    }
    return teamDb;
  }
  async function chooseMode(mode) {
    audio.pause();
    config.mode = mode;
    await saveConfig();
    state.mode = mode;
    document.body.dataset.mode = mode;
    const active = mode === "player" ? await teamDatabase() : ownerDb;
    await activate(active);
    await refreshStatus();
    $("modeDialog").close();
    resolveChoice?.(active);
    resolveChoice = null;
  }
  function showModeDialog(purpose) {
    modeDialogPurpose = purpose;
    $("modeError").textContent = "";
    $("modePin").value = "";
    $("modePinConfirm").value = "";
    $("modePinFields").hidden = true;
    $("modePinSubmit").hidden = true;
    $("chooseManager").hidden = state.mode === "player";
    $("choosePlayer").hidden = state.mode === "player";
    $("modeTitle").textContent =
      state.mode === "player"
        ? "Salir del modo reproductor"
        : "¿Cómo vas a usar la app?";
    $("modeCancel").hidden = purpose === "initial";
    if (state.mode === "player") {
      $("modePinFields").hidden = false;
      $("modePinConfirmLabel").hidden = true;
      $("modePinSubmit").hidden = false;
      $("pinExplanation").textContent =
        "Escribe el PIN de cuatro dígitos para volver a gestionar la música.";
    }
    $("modeDialog").showModal();
  }
  $("modeDialog").addEventListener("cancel", (event) => {
    if (modeDialogPurpose === "initial") event.preventDefault();
  });
  $("settingsBtn").onclick = () => {
    if (state.busy || operation) {
      notify("Espera a que termine la operación actual.");
      return;
    }
    showModeDialog("settings");
  };
  $("modeCancel").onclick = () => $("modeDialog").close();
  $("chooseManager").onclick = async () => {
    try {
      await chooseMode("edit");
    } catch {
      $("modeError").textContent = "No se ha podido guardar el modo.";
    }
  };
  $("choosePlayer").onclick = () => {
    $("modePinFields").hidden = false;
    $("modePinConfirmLabel").hidden = false;
    $("modePinSubmit").hidden = false;
    $("pinExplanation").textContent =
      "Define un PIN de cuatro dígitos para evitar cambios por error. Se guarda como hash y no es una medida de seguridad real.";
    $("modePin").focus();
  };
  $("modeForm").onsubmit = async (event) => {
    event.preventDefault();
    $("modeError").textContent = "";
    try {
      const pin = $("modePin").value;
      if (state.mode === "player") {
        if (!(await verifyPin(pin, config.pin)))
          throw new Error("El PIN no es correcto.");
        await chooseMode("edit");
      } else {
        if (pin !== $("modePinConfirm").value)
          throw new Error("Los PIN no coinciden.");
        config.pin = await makePin(pin);
        await chooseMode("player");
      }
      $("modePin").value = $("modePinConfirm").value = "";
    } catch (error) {
      $("modeError").textContent = error.message;
    }
  };

  async function initialize(db) {
    ownerDb = db;
    preferencesDb = await openPreferencesDatabase();
    config = (await getSetting(preferencesDb, "app")) || {};
    if (config.mode === "player" && config.pin?.hash) {
      state.mode = "player";
      document.body.dataset.mode = "player";
      return await teamDatabase();
    }
    if (config.mode === "edit") {
      state.mode = "edit";
      document.body.dataset.mode = "edit";
      return ownerDb;
    }
    state.mode = "choose";
    document.body.dataset.mode = "choose";
    return await new Promise((resolve) => {
      resolveChoice = resolve;
      showModeDialog("initial");
    });
  }

  async function refreshStatus() {
    if (!ownerDb) return;
    $("currentMode").textContent =
      state.mode === "player" ? "Reproductor del equipo" : "Gestión de música";
    if (state.mode !== "player") return;
    const db = await teamDatabase();
    const packet = await getSetting(db, "publication");
    const available = new Set(
      (await readStore(db, "audio")).map((item) => item.id),
    );
    const missing = state.tracks.filter((track) => !available.has(track.id));
    $("teamVersion").textContent = packet
      ? `Publicación ${packet.publicationVersion} · ${new Date(packet.publishedAt).toLocaleString("es-ES")} · ${state.playlists.length} listas · ${state.tracks.length - missing.length} canciones listas · ${missing.length} pendientes`
      : "Carga el paquete wcsl-datos.json de Ray para empezar.";
    $("missingTracks").innerHTML = missing.length
      ? `<summary>Faltan ${missing.length} canciones · ver archivos</summary><ul>${missing.map((track) => `<li>${escape(track.filename || track.title)}</li>`).join("")}</ul>`
      : "";
    $("teamAudioBtn").hidden = missing.length === 0;
    $("teamFolderBtn").hidden = missing.length === 0;
  }

  async function publish() {
    if (state.mode !== "edit" || state.busy || operation) return;
    operation = true;
    try {
      // Reservar versión dentro de una transacción: dos pestañas no publican el mismo número.
      let version;
      await writeStores(preferencesDb, ["settings"], (tx) => {
        const settings = tx.objectStore("settings");
        const request = settings.get("publicationCounter");
        request.onsuccess = () => {
          version = (request.result?.value || 0) + 1;
          settings.put({ key: "publicationCounter", value: version });
        };
      });
      const packet = createTeamPackage(state.tracks, state.playlists, version);
      downloadJson(packet, "wcsl-datos.json");
      notify(
        `Publicación ${version} preparada. Guarda wcsl-datos.json en la carpeta compartida de OneDrive o Drive junto a los MP3.`,
      );
    } catch (error) {
      notify(error.message);
    } finally {
      operation = false;
    }
  }
  $("publishBtn").onclick = publish;
  $("teamLoadBtn").onclick = $("teamUpdateBtn").onclick = () =>
    $("teamJsonFile").click();
  $("teamJsonFile").onchange = async (event) => {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file || state.mode !== "player" || operation) return;
    operation = true;
    try {
      if (file.size > MAX_SHARE_BYTES)
        throw new Error("El paquete debe pesar menos de 1 MB.");
      const packet = validateTeamPackage(JSON.parse(await file.text()));
      const db = await teamDatabase();
      const audios = await readStore(db, "audio");
      preview = prepareTeamReplacement(packet, audios);
      const previous = await getSetting(db, "publication");
      $("teamPreviewText").textContent =
        `Publicación ${packet.publicationVersion} · ${new Date(packet.publishedAt).toLocaleString("es-ES")}. Se reemplazarán todas las listas y fichas del equipo: ${packet.playlists.length} listas, ${preview.matched.length} canciones listas y ${preview.missing.length} pendientes. Tu biblioteca de gestión se conserva aparte.${previous && packet.publicationVersion <= previous.publicationVersion ? " Atención: esta versión es igual o anterior a la cargada." : ""}`;
      $("teamPreviewMissing").innerHTML = preview.missing
        .map((track) => `<li>${escape(track.filename || track.title)}</li>`)
        .join("");
      $("teamPreview").showModal();
    } catch (error) {
      notify(error.message);
    } finally {
      operation = false;
    }
  };
  $("cancelTeamPreview").onclick = () => {
    preview = null;
    $("teamPreview").close();
  };
  $("confirmTeamPreview").onclick = async () => {
    if (!preview || state.mode !== "player" || operation) return;
    operation = true;
    setBusy(true);
    try {
      const update = preview;
      const db = await teamDatabase();
      const originalAudio = new Map(
        (await readStore(db, "audio")).map((record) => [record.id, record]),
      );
      audio.pause();
      await writeStores(
        db,
        ["tracks", "playlists", "audio", "settings"],
        (tx) => {
          tx.objectStore("tracks").clear();
          tx.objectStore("playlists").clear();
          for (const track of update.tracks)
            tx.objectStore("tracks").put(track);
          for (const list of update.playlists)
            tx.objectStore("playlists").put(list);
          for (const match of update.matched) {
            const record = originalAudio.get(match.localId);
            tx.objectStore("audio").put({ ...record, id: match.publishedId });
          }
          tx.objectStore("settings").put({
            key: "publication",
            value: {
              publicationVersion: update.packet.publicationVersion,
              publishedAt: update.packet.publishedAt,
            },
          });
        },
      );
      await activate(db);
      await refreshStatus();
      $("teamPreview").close();
      preview = null;
      notify(
        "Paquete cargado. Añade únicamente los MP3 que figuran como pendientes.",
      );
    } catch (error) {
      notify(`No se ha aplicado la actualización: ${error.message}`);
    } finally {
      setBusy(false);
      operation = false;
    }
  };

  async function loadAudio(files) {
    if (state.mode !== "player" || state.busy || operation) return;
    operation = true;
    setBusy(true);
    let added = 0;
    let ignored = 0;
    try {
      const db = await teamDatabase();
      for (let index = 0; index < files.length; index++) {
        const file = files[index];
        if (
          !file.type.startsWith("audio/") &&
          !/\.(mp3|wav|flac|m4a|ogg|aac|opus)$/i.test(file.name)
        ) {
          ignored++;
          continue;
        }
        progress(
          `Emparejando audio ${index + 1}/${files.length}: ${file.name}`,
        );
        const available = new Set(
          (await readStore(db, "audio")).map((record) => record.id),
        );
        const pending = state.tracks.filter(
          (track) => !available.has(track.id),
        );
        if (!pending.length) break;
        const id = await hash(file);
        const seconds = await audioDuration(file);
        if (!seconds) {
          ignored++;
          continue;
        }
        const matched = matchTracks(pending, [
          { id, hash: id, filename: file.name, duration: seconds },
        ]).matched;
        if (!matched.length) {
          ignored++;
          continue;
        }
        for (const match of matched) {
          await writeStores(db, ["audio"], (tx) =>
            tx.objectStore("audio").put({
              id: match.publishedId,
              hash: id,
              filename: file.name,
              duration: seconds,
              blob: file,
            }),
          );
          added++;
        }
      }
      await reload();
      await refreshStatus();
      notify(
        `${added} canciones listas. ${ignored} archivos omitidos (sin coincidencia inequívoca o formato no compatible).`,
      );
    } catch (error) {
      notify(`Carga parcial: ${added} canciones. ${error.message}`);
    } finally {
      progress("");
      setBusy(false);
      operation = false;
    }
  }
  $("teamAudioBtn").onclick = () => $("teamAudioFiles").click();
  $("teamFolderBtn").onclick = () => $("teamFolderFiles").click();
  $("teamAudioFiles").onchange = $("teamFolderFiles").onchange = (event) => {
    const files = [...event.target.files];
    event.target.value = "";
    loadAudio(files);
  };
  $("freeSpaceBtn").onclick = async () => {
    if (state.mode !== "player" || state.busy || operation) return;
    try {
      const db = await teamDatabase();
      const unused = unreferencedAudioIds(
        state.playlists,
        await readStore(db, "audio"),
      );
      if (!unused.length) {
        notify("No hay audios fuera de las listas que se puedan liberar.");
        return;
      }
      if (
        !confirm(
          `¿Borrar ${unused.length} audios del equipo que ya no están en ninguna lista? Se conservan las fichas, los archivos originales y la biblioteca de gestión.`,
        )
      )
        return;
      audio.pause();
      await writeStores(db, ["audio"], (tx) => {
        for (const id of unused) tx.objectStore("audio").delete(id);
      });
      await activate(db);
      await refreshStatus();
      notify("Espacio liberado.");
    } catch (error) {
      notify(error.message);
    }
  };
  return {
    initialize,
    refreshStatus,
    config: () => config,
    setKeepAwake: async (value) => {
      config.keepAwake = value;
      await saveConfig();
    },
  };
}
