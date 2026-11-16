export function validPin(pin) {
  return typeof pin === "string" && /^\d{4}$/.test(pin);
}
export async function pinDigest(pin, salt) {
  const bytes = new TextEncoder().encode(`wcsl-player:${salt}:${pin}`);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}
export async function makePin(pin) {
  if (!validPin(pin)) throw new Error("El PIN debe tener cuatro dígitos.");
  const salt = crypto.randomUUID();
  return { salt, hash: await pinDigest(pin, salt) };
}
export async function verifyPin(pin, stored) {
  if (!validPin(pin) || !stored?.salt || !stored?.hash) return false;
  return (await pinDigest(pin, stored.salt)) === stored.hash;
}
