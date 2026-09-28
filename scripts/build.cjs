/* Publish only browser assets; configuration contains public credentials only. */
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { validateConfig } = require("../js/backend.js");
const root = path.resolve(__dirname, "..");
const dest = path.join(root, "dist");
let config;
if (
  process.env.SUPABASE_URL ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  process.env.SUPABASE_ANON_KEY
) {
  config = {
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
  };
} else {
  const context = { window: {} };
  if (!fs.existsSync(path.join(root, "config.js")))
    throw new Error(
      "Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY for the build, or supply local config.js.",
    );
  vm.runInNewContext(
    fs.readFileSync(path.join(root, "config.js"), "utf8"),
    context,
    { timeout: 1000 },
  );
  config = context.window.NECTARSPEND_CONFIG || context.window.FOLD_CONFIG;
}
const publicConfig = validateConfig(config);
config = {
  SUPABASE_URL: publicConfig.url,
  SUPABASE_PUBLISHABLE_KEY: publicConfig.key,
};
// This fixed path is a generated directory inside the project, never a user input.
if (path.dirname(dest) !== root || path.basename(dest) !== "dist")
  throw new Error("Invalid build destination.");
fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest);
fs.copyFileSync(path.join(root, "index.html"), path.join(dest, "index.html"));
for (const dir of ["css", "js", "assets"]) {
  fs.mkdirSync(path.join(dest, dir));
  for (const item of fs.readdirSync(path.join(root, dir), {
    withFileTypes: true,
  })) {
    if (item.isFile() && /^[\w.-]+$/.test(item.name))
      fs.copyFileSync(
        path.join(root, dir, item.name),
        path.join(dest, dir, item.name),
      );
  }
}
fs.writeFileSync(
  path.join(dest, "config.js"),
  "window.NECTARSPEND_CONFIG = Object.freeze(" +
    JSON.stringify(config) +
    ");\n",
);
console.log(
  "NectarSpend built in dist/. Only browser assets and public configuration included.",
);
