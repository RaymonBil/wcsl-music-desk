import { moveToIndex, playlistStats } from "./library-core.js";

export function describePlaylist(list, tracks) {
  const stats = playlistStats(list, tracks);
  const duration = `${Math.floor(stats.duration / 60)}:${String(Math.floor(stats.duration % 60)).padStart(2, "0")}`;
  const range =
    stats.minBpm === null
      ? "Sin BPM"
      : stats.minBpm === stats.maxBpm
        ? `${stats.minBpm} BPM`
        : `${stats.minBpm}–${stats.maxBpm} BPM`;
  return `${stats.count} temas · ${duration} · ${range}`;
}

export function setupPointerReordering({
  container,
  getPlaylist,
  canReorder,
  save,
  render,
  notify,
}) {
  let drag = null;
  let frame = null;
  const clear = () => {
    cancelAnimationFrame(frame);
    container
      .querySelectorAll(".drop-target, .dragging-row")
      .forEach((row) => row.classList.remove("drop-target", "dragging-row"));
    drag = null;
  };
  const scroll = () => {
    if (!drag) return;
    const edge = 100;
    if (drag.y < edge) window.scrollBy(0, -10);
    if (drag.y > window.innerHeight - 220) window.scrollBy(0, 10);
    frame = requestAnimationFrame(scroll);
  };
  container.addEventListener("pointerdown", (event) => {
    const handle = event.target.closest("[data-drag]");
    if (!handle || event.button !== 0 || !canReorder()) return;
    const list = getPlaylist();
    if (!list) return;
    event.preventDefault();
    drag = {
      id: handle.dataset.drag,
      playlistId: list.id,
      target: handle.dataset.drag,
      pointerId: event.pointerId,
      y: event.clientY,
    };
    handle.setPointerCapture(event.pointerId);
    handle.closest("tr").classList.add("dragging-row");
    frame = requestAnimationFrame(scroll);
  });
  container.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    event.preventDefault();
    drag.y = event.clientY;
    const row = document
      .elementFromPoint(event.clientX, event.clientY)
      ?.closest("tr[data-track]");
    if (!row || !container.contains(row)) return;
    drag.target = row.dataset.track;
    container
      .querySelectorAll(".drop-target")
      .forEach((node) => node.classList.remove("drop-target"));
    row.classList.add("drop-target");
  });
  container.addEventListener("pointerup", async (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const { id, target, playlistId } = drag;
    clear();
    const list = getPlaylist();
    if (!list || list.id !== playlistId || !canReorder()) return;
    const moved = moveToIndex(list, id, list.trackIds.indexOf(target));
    if (moved === list) return;
    try {
      await save(moved);
      await render();
      notify("Orden de la lista guardado.");
    } catch {
      notify("No se ha podido guardar el orden.");
    }
  });
  container.addEventListener("pointercancel", clear);
  container.addEventListener("lostpointercapture", clear);
}
