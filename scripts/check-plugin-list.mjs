// Checks plugins/index.json, the public list the settings window installs
// from, by the rules of src-tauri/src/marketplace.rs. The app leaves out an
// entry it cannot use; this says which and why, so that a pull request can be
// fixed before it is merged.
//
//   node scripts/check-plugin-list.mjs [--download] [file]
//
// With --download, every zip is fetched and must match its entry: the
// checksum, and the name, permissions and hosts in its plugin.json.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

const args = process.argv.slice(2);
const download = args.includes("--download");
const file = args.find((arg) => !arg.startsWith("--")) ?? "plugins/index.json";

const NAME = /^[a-z0-9-]{1,64}$/;
const TOKEN = /^[A-Za-z0-9._-]{1,100}$/;
const MAX_ZIP_BYTES = 20 * 1024 * 1024;
const problems = [];

const isText = (value, max) =>
  typeof value === "string" && value.trim() !== "" && [...value.trim()].length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const isHttps = (value) => {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
};

function checkEntry(entry, index) {
  const where = `entry ${index + 1}${typeof entry?.name === "string" ? ` (${entry.name})` : ""}`;
  const fail = (text) => problems.push(`${where}: ${text}`);
  if (typeof entry !== "object" || entry === null) return fail("is not an object");
  if (!isText(entry.name, 64) || !NAME.test(entry.name)) fail("name must be lowercase letters, digits and -");
  if (!isText(entry.version, 20)) fail("version is missing or longer than 20 characters");
  if (!isText(entry.description, 300)) fail("description is missing or longer than 300 characters");
  if (!isText(entry.author, 60)) fail("author is missing or longer than 60 characters");
  if (entry.homepage !== undefined && entry.homepage !== null && !(isText(entry.homepage, 500) && isHttps(entry.homepage))) {
    fail("homepage must be an https address");
  }
  if (!(isText(entry.url, 500) && isHttps(entry.url))) fail("url must be an https address of the zip file");
  if (typeof entry.sha256 !== "string" || !/^[0-9a-fA-F]{64}$/.test(entry.sha256)) fail("sha256 must be 64 hex digits");
  for (const [key, max] of [
    ["permissions", 10],
    ["hosts", 20],
  ]) {
    const list = entry[key] ?? [];
    if (!Array.isArray(list) || list.length > max || !list.every((item) => typeof item === "string" && TOKEN.test(item))) {
      fail(`${key} must be a list of at most ${max} names`);
    }
  }
}

/** The text of plugin.json in a zip, at the top or in its one folder. */
function manifestFromZip(zip) {
  const end = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error("not a zip file");
  const count = zip.readUInt16LE(end + 10);
  let offset = zip.readUInt32LE(end + 16);
  for (let i = 0; i < count; i++) {
    const method = zip.readUInt16LE(offset + 10);
    const size = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const local = zip.readUInt32LE(offset + 42);
    const name = zip.toString("utf8", offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;
    if (!/^([^/]+\/)?plugin\.json$/.test(name)) continue;
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(start, start + size);
    return (method === 0 ? data : inflateRawSync(data)).toString("utf8");
  }
  throw new Error("no plugin.json in the zip");
}

const same = (a = [], b = []) => JSON.stringify([...new Set(a)].sort()) === JSON.stringify([...new Set(b)].sort());

async function checkDownload(entry) {
  const where = `${entry.name}`;
  const before = problems.length;
  try {
    const response = await fetch(entry.url, { redirect: "follow" });
    if (!response.ok) return problems.push(`${where}: ${entry.url} answered ${response.status}`);
    const zip = Buffer.from(await response.arrayBuffer());
    if (zip.length > MAX_ZIP_BYTES) return problems.push(`${where}: the zip is larger than 20 MB`);
    const sha = createHash("sha256").update(zip).digest("hex");
    if (sha !== entry.sha256.toLowerCase()) return problems.push(`${where}: sha256 is ${sha}, the list says ${entry.sha256}`);
    const manifest = JSON.parse(manifestFromZip(zip));
    if (manifest.name !== entry.name) problems.push(`${where}: plugin.json names "${manifest.name}"`);
    if (!same(manifest.permissions, entry.permissions)) problems.push(`${where}: plugin.json asks for ${JSON.stringify(manifest.permissions ?? [])}, the list shows ${JSON.stringify(entry.permissions ?? [])}`);
    if (!same(manifest.hosts, entry.hosts)) problems.push(`${where}: plugin.json contacts ${JSON.stringify(manifest.hosts ?? [])}, the list shows ${JSON.stringify(entry.hosts ?? [])}`);
    if (manifest.version !== entry.version) problems.push(`${where}: plugin.json has version ${manifest.version}, the list ${entry.version}`);
    if (problems.length === before) console.log(`${where}: download matches`);
  } catch (error) {
    problems.push(`${where}: ${error.message}`);
  }
}

let list;
try {
  list = JSON.parse(readFileSync(file, "utf8"));
} catch (error) {
  console.error(`${file}: ${error.message}`);
  process.exit(1);
}
if (!Array.isArray(list?.plugins)) {
  console.error(`${file}: needs a "plugins" list`);
  process.exit(1);
}
list.plugins.forEach(checkEntry);
const names = list.plugins.map((entry) => entry?.name);
for (const name of new Set(names.filter((name, i) => names.indexOf(name) !== i))) problems.push(`${name}: listed twice`);
if (download && problems.length === 0) {
  for (const entry of list.plugins) await checkDownload(entry);
}

// exitCode, not exit(): on Windows, exiting while fetch still closes its
// connections crashes Node.
if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`${file}: ${list.plugins.length} plugin(s), all usable${download ? " and matching their downloads" : ""}`);
}
