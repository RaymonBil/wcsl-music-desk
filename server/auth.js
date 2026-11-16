// Verificación del token de Cloudflare Access (JWT RS256) con WebCrypto.
// Sin dependencias: funciona igual en Cloudflare Pages Functions y en Node (tests).

const keyCache = new Map(); // teamDomain -> { keys, fetchedAt }
const KEY_TTL_MS = 60 * 60 * 1000;

function base64UrlToBytes(value) {
  let text = value.replace(/-/g, "+").replace(/_/g, "/");
  while (text.length % 4) text += "=";
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeSegment(segment) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment)));
}

export function normalizeTeamDomain(domain) {
  const text = String(domain || "").trim().replace(/\/+$/, "");
  if (!text) return "";
  return text.startsWith("https://") ? text : `https://${text}`;
}

async function defaultFetchKeys(teamDomain) {
  const response = await fetch(`${teamDomain}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error("No se pueden obtener las claves de Access");
  const body = await response.json();
  return Array.isArray(body.keys) ? body.keys : [];
}

async function findKey(teamDomain, kid, fetchKeys, now) {
  const cached = keyCache.get(teamDomain);
  let keys = cached && now - cached.fetchedAt < KEY_TTL_MS ? cached.keys : null;
  let key = keys?.find((k) => k.kid === kid);
  if (!key) {
    // Clave nueva o rotada: se vuelve a pedir una sola vez.
    keys = await fetchKeys(teamDomain);
    keyCache.set(teamDomain, { keys, fetchedAt: now });
    key = keys.find((k) => k.kid === kid);
  }
  return key || null;
}

export function clearKeyCache() {
  keyCache.clear();
}

/**
 * Devuelve { email } si el token es válido para esta aplicación; lanza un error en caso contrario.
 */
export async function verifyAccessToken(
  token,
  { teamDomain, audience, fetchKeys = defaultFetchKeys, nowSeconds } = {},
) {
  const domain = normalizeTeamDomain(teamDomain);
  if (!token || typeof token !== "string") throw new Error("Falta el token de acceso");
  if (!domain || !audience) throw new Error("Access no está configurado");
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Token mal formado");
  const [headerPart, payloadPart, signaturePart] = parts;
  let header, payload;
  try {
    header = decodeSegment(headerPart);
    payload = decodeSegment(payloadPart);
  } catch {
    throw new Error("Token mal formado");
  }
  if (header.alg !== "RS256" || !header.kid) throw new Error("Algoritmo no admitido");

  const now = nowSeconds ?? Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(audience)) throw new Error("Token de otra aplicación");
  if (payload.iss !== domain) throw new Error("Emisor no válido");
  if (typeof payload.exp !== "number" || payload.exp < now - 30)
    throw new Error("Sesión caducada");
  if (typeof payload.nbf === "number" && payload.nbf > now + 30)
    throw new Error("Token todavía no válido");

  const jwk = await findKey(domain, header.kid, fetchKeys, now * 1000);
  if (!jwk) throw new Error("Clave de firma desconocida");
  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    base64UrlToBytes(signaturePart),
    new TextEncoder().encode(`${headerPart}.${payloadPart}`),
  );
  if (!valid) throw new Error("Firma no válida");
  const email = String(payload.email || "").trim().toLowerCase();
  if (!email) throw new Error("El token no incluye correo");
  return { email };
}

export function readAccessToken(request) {
  const header = request.headers.get("Cf-Access-Jwt-Assertion");
  if (header) return header;
  const cookie = request.headers.get("Cookie") || "";
  const match = cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}
