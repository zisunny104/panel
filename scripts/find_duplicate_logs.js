import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const root = path.join(__dirname, "..", "js");
const walk = (dir) => {
  const res = [];
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    const stat = fs.statSync(p);
    if (stat.isDirectory()) res.push(...walk(p));
    else if (p.endsWith(".js")) res.push(p);
  }
  return res;
};

const files = walk(root);
const re = /Logger\.(debug|info|warn|error)\s*\(\s*([`'\"])(([\s\S]*?))\2/gi;
const results = new Map();

for (const file of files) {
  const content = fs.readFileSync(file, "utf8");
  let match;
  while ((match = re.exec(content)) !== null) {
    const raw = match[3].trim();
    const idx = match.index;
    const prefix = content.slice(0, idx);
    const line = prefix.split(/\r?\n/).length;
    const key = raw;
    const arr = results.get(key) || [];
    arr.push({ file: path.relative(process.cwd(), file), line });
    results.set(key, arr);
  }
}

const duplicates = [];
for (const [msg, occ] of results.entries()) {
  if (occ.length > 1) duplicates.push({ msg, occ });
}

if (duplicates.length === 0) {
  console.log("No duplicate Logger messages found (by exact literal).");
} else {
  console.log("Duplicate Logger messages (exact literal) found:\n");
  for (const d of duplicates) {
    console.log("---");
    console.log("Message:");
    console.log(d.msg);
    console.log("Occurrences:");
    d.occ.forEach((o) => console.log(` - ${o.file}:L${o.line}`));
  }
}
