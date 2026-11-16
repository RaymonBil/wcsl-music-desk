import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

async function serviceWorker() {
  const events = new Map(),
    saved = new Map();
  let online = true;
  const normalize = (key) => (typeof key === "string" ? key : key.url);
  const cache = {
    async put(key, response) {
      saved.set(normalize(key), response.clone());
    },
    async match(key) {
      return saved.get(normalize(key))?.clone();
    },
  };
  const caches = {
    open: async () => cache,
    keys: async () => ["other-app", "wcsl-shell-old"],
    delete: async (key) => {
      assert.notEqual(key, "other-app");
    },
  };
  const scope = "https://music.test/";
  vm.runInNewContext(
    await readFile(new URL("../dist/sw.js", import.meta.url), "utf8"),
    {
      URL,
      caches,
      self: {
        registration: { scope },
        clients: { claim: async () => {} },
        skipWaiting: async () => {},
        addEventListener: (name, fn) => events.set(name, fn),
      },
      fetch: async (request) => {
        if (!online) throw Error("offline");
        const url = normalize(request);
        return new Response(
          url.endsWith(".js") ? "// cached" : "<html>shell</html>",
          {
            headers: {
              "Content-Type": url.endsWith(".js")
                ? "application/javascript"
                : "text/html",
            },
          },
        );
      },
    },
  );
  const run = async (name) => {
    let promise;
    events.get(name)({
      waitUntil(value) {
        promise = value;
      },
    });
    await promise;
  };
  return {
    events,
    saved,
    run,
    offline: () => {
      online = false;
    },
    request(url) {
      let result;
      events.get("fetch")({
        request: { method: "GET", url },
        respondWith(value) {
          result = value;
        },
      });
      return result;
    },
  };
}
test("el shell guardado abre sin red y no intercepta audio ni otros sitios", async () => {
  const sw = await serviceWorker();
  await sw.run("install");
  await sw.run("activate");
  assert.ok(sw.saved.has("https://music.test/"));
  assert.ok(sw.saved.has("https://music.test/team-controls.js"));
  sw.offline();
  assert.equal((await sw.request("https://music.test/")).status, 200);
  assert.equal((await sw.request("https://music.test/app.js")).status, 200);
  assert.equal(sw.request("https://music.test/song.mp3"), undefined);
  assert.equal(sw.request("https://other.test/"), undefined);
});
