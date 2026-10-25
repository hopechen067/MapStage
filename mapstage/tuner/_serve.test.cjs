const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const zlib = require("node:zlib");
const { createServer } = require("./_serve.cjs");

function request(port, url, { method = "GET", headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port, path: url, method, headers },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () =>
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          })
        );
      }
    );
    req.on("error", reject);
    req.end();
  });
}

test("static delivery and tile cache semantics", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "china-map-serve-"));
  const tileCacheDir = path.join(tempRoot, "_tile_cache");
  const geojson = Buffer.from('{"type":"FeatureCollection","features":[]}');
  const script = Buffer.from("window.testValue = 1;\n");
  const tileBody = Buffer.from("fake-webp-tile");
  let fetchCount = 0;
  const staticEncodingCache = new Map();

  await Promise.all([
    fs.writeFile(path.join(tempRoot, "index.html"), "<!doctype html><title>test</title>"),
    fs.writeFile(path.join(tempRoot, "data.geojson"), geojson),
    fs.writeFile(path.join(tempRoot, "app.js"), script),
    fs.writeFile(path.join(tempRoot, "sample.webp"), "webp"),
    fs.writeFile(path.join(tempRoot, "sample.pbf"), "pbf"),
  ]);

  const server = createServer({
    root: tempRoot,
    tileCacheDir,
    staticEncodingCache,
    fetch: async () => {
      fetchCount += 1;
      await new Promise((resolve) => setTimeout(resolve, 30));
      return {
        ok: true,
        status: 200,
        headers: { get: (name) => (name.toLowerCase() === "content-type" ? "image/webp" : null) },
        arrayBuffer: async () => Uint8Array.from(tileBody).buffer,
      };
    },
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;

  try {
    const br = await request(port, "/data.geojson", {
      headers: { "Accept-Encoding": "br" },
    });
    assert.equal(br.status, 200);
    assert.match(br.headers["content-type"], /^application\/geo\+json/);
    assert.equal(br.headers["content-encoding"], "br");
    assert.equal(br.headers.vary, "Accept-Encoding");
    assert.deepEqual(zlib.brotliDecompressSync(br.body), geojson);
    assert.ok(br.headers.etag);
    const brAgain = await request(port, "/data.geojson", {
      headers: { "Accept-Encoding": "br" },
    });
    assert.deepEqual(brAgain.body, br.body);
    assert.equal(staticEncodingCache.size, 1);

    const notModified = await request(port, "/data.geojson", {
      headers: {
        "Accept-Encoding": "gzip",
        "If-None-Match": br.headers.etag,
      },
    });
    assert.equal(notModified.status, 304);
    assert.equal(notModified.body.length, 0);

    const head = await request(port, "/data.geojson", {
      method: "HEAD",
      headers: { "Accept-Encoding": "br" },
    });
    assert.equal(head.status, 200);
    assert.equal(head.body.length, 0);
    assert.equal(Number(head.headers["content-length"]), br.body.length);

    const versioned = await request(port, "/app.js?v=build-1", {
      headers: { "Accept-Encoding": "gzip" },
    });
    assert.equal(versioned.headers["content-encoding"], "gzip");
    assert.equal(versioned.headers["cache-control"], "public, max-age=31536000, immutable");
    assert.deepEqual(zlib.gunzipSync(versioned.body), script);

    const html = await request(port, "/index.html?v=build-1");
    assert.equal(html.headers["cache-control"], "no-cache");
    const rootIndex = await request(port, "/");
    assert.equal(rootIndex.status, 200);
    assert.match(rootIndex.headers["content-type"], /^text\/html/);
    assert.equal(rootIndex.body.toString(), "<!doctype html><title>test</title>");
    assert.equal((await request(port, "/sample.webp")).headers["content-type"], "image/webp");
    assert.equal(
      (await request(port, "/sample.pbf")).headers["content-type"],
      "application/vnd.mapbox-vector-tile"
    );

    const tileUrl = "/t/tiles.maps.eox.at/test/tile.webp?z=1";
    const [tileGet, tileHead] = await Promise.all([
      request(port, tileUrl),
      request(port, tileUrl, { method: "HEAD" }),
    ]);
    assert.equal(fetchCount, 1);
    assert.equal(tileGet.headers["x-tile-cache"], "miss");
    assert.equal(tileHead.headers["x-tile-cache"], "miss");
    assert.equal(tileGet.headers["content-type"], "image/webp");
    assert.deepEqual(tileGet.body, tileBody);
    assert.equal(tileHead.body.length, 0);

    const upstream = "https://tiles.maps.eox.at/test/tile.webp?z=1";
    const key = crypto.createHash("sha256").update(upstream).digest("hex");
    assert.deepEqual(await fs.readFile(path.join(tileCacheDir, key)), tileBody);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(tileCacheDir, key + ".json"))), {
      contentType: "image/webp",
    });

    const tileHit = await request(port, tileUrl);
    assert.equal(tileHit.headers["x-tile-cache"], "hit");
    assert.equal(tileHit.headers["content-type"], "image/webp");
    assert.equal(fetchCount, 1);

    const legacyUpstream = "https://tiles.maps.eox.at/legacy/tile.png";
    const legacyKey = crypto.createHash("sha256").update(legacyUpstream).digest("hex");
    await fs.writeFile(path.join(tileCacheDir, legacyKey), "legacy");
    const legacyHit = await request(port, "/t/tiles.maps.eox.at/legacy/tile.png");
    assert.equal(legacyHit.headers["x-tile-cache"], "hit");
    assert.equal(legacyHit.headers["content-type"], "image/png");
    assert.equal(fetchCount, 1);

    assert.equal((await request(port, "/t/example.com/tile.png")).status, 403);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("root path prefers home.html foyer when present", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "china-map-home-"));
  await Promise.all([
    fs.writeFile(path.join(tempRoot, "index.html"), "<!doctype html><title>tuner</title>"),
    fs.writeFile(path.join(tempRoot, "home.html"), "<!doctype html><title>foyer</title>"),
  ]);
  const server = createServer({
    root: tempRoot,
    tileCacheDir: path.join(tempRoot, "_tile_cache"),
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  try {
    const rootPage = await request(port, "/");
    assert.equal(rootPage.status, 200);
    assert.equal(rootPage.body.toString(), "<!doctype html><title>foyer</title>");
    const tuner = await request(port, "/index.html");
    assert.equal(tuner.body.toString(), "<!doctype html><title>tuner</title>");
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
