// Sustitutos mínimos de D1 (sobre node:sqlite) y R2 (en memoria) para probar la API sin Cloudflare.
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";

class Statement {
  constructor(db, sql, params = []) {
    this.db = db;
    this.sql = sql;
    this.params = params;
  }
  bind(...params) {
    return new Statement(this.db, this.sql, params);
  }
  execute() {
    const stmt = this.db.prepare(this.sql);
    if (stmt.columns().length) return { results: stmt.all(...this.params), meta: { changes: 0 } };
    const info = stmt.run(...this.params);
    return { results: [], meta: { changes: Number(info.changes) } };
  }
  async first() {
    return this.execute().results[0] ?? null;
  }
  async all() {
    return this.execute();
  }
  async run() {
    return this.execute();
  }
}

export class FakeD1 {
  constructor() {
    this.db = new DatabaseSync(":memory:");
  }
  prepare(sql) {
    return new Statement(this.db, sql);
  }
  async batch(statements) {
    this.db.exec("BEGIN");
    try {
      const out = statements.map((s) => s.execute());
      this.db.exec("COMMIT");
      return out;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

export class FakeR2 {
  constructor() {
    this.objects = new Map();
  }
  async put(key, body, options = {}) {
    const bytes = new Uint8Array(await new Response(body).arrayBuffer());
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (options.sha256 && options.sha256 !== digest) throw new Error("checksum mismatch");
    this.objects.set(key, { bytes, contentType: options.httpMetadata?.contentType, etag: digest });
  }
  object(key, stored, range) {
    return {
      key,
      size: stored.bytes.length,
      httpEtag: `"${stored.etag}"`,
      range,
      writeHttpMetadata(headers) {
        if (stored.contentType) headers.set("Content-Type", stored.contentType);
      },
    };
  }
  async head(key) {
    const stored = this.objects.get(key);
    return stored ? this.object(key, stored) : null;
  }
  async get(key, options = {}) {
    const stored = this.objects.get(key);
    if (!stored) return null;
    let range;
    const header = options.range?.get?.("Range");
    let bytes = stored.bytes;
    const match = header?.match(/bytes=(\d*)-(\d*)/);
    if (match) {
      if (match[1] === "") {
        range = { suffix: Number(match[2]) };
        bytes = bytes.slice(bytes.length - range.suffix);
      } else {
        const offset = Number(match[1]);
        const end = match[2] === "" ? bytes.length - 1 : Number(match[2]);
        range = { offset, length: end - offset + 1 };
        bytes = bytes.slice(offset, end + 1);
      }
    }
    return { ...this.object(key, stored, range), body: new Blob([bytes]).stream() };
  }
  async delete(key) {
    this.objects.delete(key);
  }
}

// Claves RSA y tokens firmados como los de Cloudflare Access.
export async function createAccessIssuer(teamDomain, audience) {
  const pair = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  );
  const jwk = { ...(await crypto.subtle.exportKey("jwk", pair.publicKey)), kid: "test-key" };
  const b64 = (value) =>
    Buffer.from(typeof value === "string" ? value : value).toString("base64url");
  async function sign(claims = {}) {
    const now = Math.floor(Date.now() / 1000);
    const header = b64(JSON.stringify({ alg: "RS256", kid: "test-key", typ: "JWT" }));
    const payload = b64(
      JSON.stringify({ aud: [audience], iss: teamDomain, exp: now + 3600, iat: now, ...claims }),
    );
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      pair.privateKey,
      new TextEncoder().encode(`${header}.${payload}`),
    );
    return `${header}.${payload}.${b64(new Uint8Array(signature))}`;
  }
  return { sign, fetchKeys: async () => [jwk] };
}
