const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const html = fs.readFileSync("index.html", "utf8");
const title = "NectarSpend — Know your money.";
const description =
  "NectarSpend helps you understand where your money goes. Record personal income, expenses, savings and goals, or keep business sales and costs organized in separate workspaces.";
const image = "https://nectarspend.com/assets/nectarspend-social.png";
const attributes = (tag) =>
  Object.fromEntries(
    [...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map((match) => [
      match[1],
      match[2],
    ]),
  );
const metadata = [...html.matchAll(/<meta\s[^>]+>/g)].map((match) =>
  attributes(match[0]),
);

test("canonical, Open Graph and Twitter metadata describe the public brand", () => {
  assert.equal(html.match(/<title>([^<]+)<\/title>/)[1], title);
  const canonical = [...html.matchAll(/<link\s[^>]+>/g)]
    .map((match) => attributes(match[0]))
    .filter((tag) => tag.rel === "canonical");
  assert.deepEqual(canonical, [
    { rel: "canonical", href: "https://nectarspend.com/" },
  ]);
  for (const [key, expected] of Object.entries({
    description,
    "og:type": "website",
    "og:site_name": "NectarSpend",
    "og:title": title,
    "og:description": description,
    "og:url": "https://nectarspend.com/",
    "og:image": image,
    "og:image:type": "image/png",
    "og:image:width": "1200",
    "og:image:height": "630",
    "og:image:alt": title,
    "twitter:card": "summary_large_image",
    "twitter:title": title,
    "twitter:description": description,
    "twitter:image": image,
    "twitter:image:alt": title,
  })) {
    const tags = metadata.filter((tag) => (tag.name || tag.property) === key);
    assert.equal(tags.length, 1, key);
    assert.equal(tags[0].content, expected, key);
  }
  assert.equal(new URL(image).protocol, "https:");
  assert.ok(
    !metadata.some((tag) =>
      ["twitter:site", "twitter:creator"].includes(tag.name),
    ),
  );
});

test("social preview is a real PNG with the advertised dimensions", () => {
  const png = fs.readFileSync("assets/nectarspend-social.png");
  assert.equal(png.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.equal(png.toString("ascii", 12, 16), "IHDR");
  assert.equal(png.readUInt32BE(16), 1200);
  assert.equal(png.readUInt32BE(20), 630);
});
