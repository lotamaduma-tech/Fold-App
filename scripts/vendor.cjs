// Copy official, locked npm distributions; no application bundler is needed.
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const source = path.join(root, "node_modules/@supabase/supabase-js");
fs.mkdirSync(path.join(root, "assets"), { recursive: true });
fs.copyFileSync(
  path.join(source, "dist/umd/supabase.js"),
  path.join(root, "assets/supabase.js"),
);
fs.copyFileSync(
  path.join(source, "LICENSE"),
  path.join(root, "assets/supabase-LICENSE"),
);
console.log("Official Supabase browser client copied to assets.");
