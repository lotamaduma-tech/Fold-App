const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawnSync } = require("node:child_process");
test("static build publishes only browser assets and rejects privileged configuration", () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "nectarspend-build-test-"),
  );
  try {
    for (const dir of ["scripts", "js", "css", "assets"])
      fs.mkdirSync(path.join(root, dir));
    for (const file of ["manifest.webmanifest", "sw.js", "privacy.html", "terms.html", "disclaimer.html"]) fs.copyFileSync(file, path.join(root, file));
    fs.copyFileSync("scripts/build.cjs", path.join(root, "scripts/build.cjs"));
    fs.copyFileSync("js/backend.js", path.join(root, "js/backend.js"));
    fs.copyFileSync("js/errors.js", path.join(root, "js/errors.js"));
    fs.copyFileSync(
      "assets/nectarspend-social.png",
      path.join(root, "assets/nectarspend-social.png"),
    );
    for (const file of ["icon-192.png", "icon-512.png", "favicon.png", "apple-touch-icon.png"]) fs.copyFileSync("assets/"+file,path.join(root,"assets",file));
    fs.copyFileSync("js/pwa.js",path.join(root,"js/pwa.js"));
    fs.writeFileSync(
      path.join(root, "index.html"),
      "<title>NectarSpend</title>",
    );
    fs.writeFileSync(path.join(root, ".env"), "PRIVATE=must-not-publish");
    const env = {
      ...process.env,
      SUPABASE_URL: "https://fixture.supabase.co",
      SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture_only",
      SUPABASE_ANON_KEY: "sb_secret_unused_must_not_publish",
    };
    fs.writeFileSync(path.join(root, "assets/.env"), "PRIVATE=must-not-publish");
    fs.writeFileSync(path.join(root, "assets/private-config.json"), "{}");
    const result = spawnSync(process.execPath, ["scripts/build.cjs"], {
      cwd: root,
      env,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    assert.ok(!fs.existsSync(path.join(root, "dist/assets/.env")));
    assert.ok(!fs.existsSync(path.join(root, "dist/assets/private-config.json")));
    const insecure = spawnSync(process.execPath, ["scripts/build.cjs"], {cwd:root,env:{...env,VERCEL:"1",SUPABASE_URL:"http://localhost:54321"},encoding:"utf8"});
    assert.notEqual(insecure.status,0);
    assert.match(insecure.stderr,/HTTPS Supabase/);
    assert.deepEqual(
      fs.readFileSync(path.join(root, "dist/assets/nectarspend-social.png")),
      fs.readFileSync("assets/nectarspend-social.png"),
    );
    assert.deepEqual(fs.readdirSync(path.join(root, "dist")).sort(), [
      "assets",
      "config.js",
      "css",
      "disclaimer.html",
      "index.html",
      "js",
      "manifest.webmanifest",
      "privacy.html",
      "sw.js",
      "terms.html",
    ]);
    for (const file of ["manifest.webmanifest", "sw.js", "js/pwa.js", "assets/icon-192.png", "assets/icon-512.png", "assets/nectarspend-social.png"]) assert.ok(fs.existsSync(path.join(root,"dist",file)),file);
    const manifest=JSON.parse(fs.readFileSync(path.join(root,"dist/manifest.webmanifest"),"utf8"));
    for(const icon of manifest.icons) assert.ok(fs.existsSync(path.join(root,"dist",icon.src)));
    assert.ok(!result.stdout.includes(env.SUPABASE_PUBLISHABLE_KEY));
    assert.ok(
      !fs
        .readFileSync(path.join(root, "dist/config.js"), "utf8")
        .includes(env.SUPABASE_ANON_KEY),
    );
    const rejected = spawnSync(process.execPath, ["scripts/build.cjs"], {
      cwd: root,
      env: { ...env, SUPABASE_PUBLISHABLE_KEY: "sb_secret_forbidden" },
      encoding: "utf8",
    });
    assert.notEqual(rejected.status, 0);
    assert.ok(!rejected.stderr.includes("sb_secret_forbidden"));
  } finally {
    // mkdtemp generated this exact test-owned path, within the OS temp directory.
    if (
      path.dirname(root) === os.tmpdir() &&
      path.basename(root).startsWith("nectarspend-build-test-")
    )
      fs.rmSync(root, { recursive: true, force: true });
  }
});
