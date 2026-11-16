// La cola es temporal y admite repeticiones. El cursor identifica una aparición,
// no el hash: la misma canción puede sonar dos veces en posiciones distintas.
export function appendToQueue(queue, ids) {
  return [...queue, ...ids];
}
export function moveQueueItem(queue, cursor, from, to) {
  if (
    !Number.isInteger(from) ||
    !Number.isInteger(to) ||
    from < 0 ||
    from >= queue.length ||
    to < 0 ||
    to >= queue.length ||
    from === to
  ) {
    return { queue, cursor };
  }
  const positions = queue.map((id, index) => ({ id, index }));
  const [entry] = positions.splice(from, 1);
  positions.splice(to, 0, entry);
  return {
    queue: positions.map((entry) => entry.id),
    cursor:
      cursor < 0 ? -1 : positions.findIndex((entry) => entry.index === cursor),
  };
}
export function removeQueueItem(queue, cursor, index) {
  // La canción actual se mantiene hasta que termine o se elija otra.
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= queue.length ||
    index === cursor
  )
    return { queue, cursor };
  return {
    queue: queue.filter((_, position) => position !== index),
    cursor: index < cursor ? cursor - 1 : cursor,
  };
}
export function nextQueueIndex(queue, cursor, direction, automatic = false) {
  if (!queue.length) return -1;
  const next = cursor < 0 ? 0 : cursor + direction;
  if (automatic && next >= queue.length) return -1;
  return (next + queue.length) % queue.length;
}
