// Build the frontend as a folder of static files for Netlify (or any static host):
//
//   npm run build:static                                    -> ../dist
//   API_URL=https://my-backend.example.com npm run build:static
//
// The folder holds no secrets. It reaches the backend at the address in
// dist/config.js, which can also be edited by hand after the build.
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(frontend, "out");
const dist = path.resolve(frontend, "..", "dist");
const configFile = path.join(dist, "config.js");

// a backend address set in an earlier dist/config.js survives a rebuild
const previous = fs.existsSync(configFile) ? fs.readFileSync(configFile, "utf8").match(/apiUrl:\s*"([^"]*)"/)?.[1] : "";
const apiUrl = (process.env.API_URL ?? previous ?? "").replace(/\/$/, "");

execSync("npx next build", { cwd: frontend, stdio: "inherit", env: { ...process.env, BUILD_TARGET: "static" } });

fs.rmSync(dist, { recursive: true, force: true });
fs.cpSync(out, dist, { recursive: true });
fs.rmSync(out, { recursive: true, force: true });

const config = fs.readFileSync(configFile, "utf8").replace(/apiUrl:\s*"[^"]*"/, `apiUrl: ${JSON.stringify(apiUrl)}`);
fs.writeFileSync(configFile, config);

// Netlify: always fetch config.js fresh; hashed build files never change.
fs.writeFileSync(path.join(dist, "_headers"), [
  "/config.js",
  "  Cache-Control: no-cache",
  "/_next/static/*",
  "  Cache-Control: public, max-age=31536000, immutable",
  "",
].join("\n"));
// Links from before the editor moved to /editor/?id=…
fs.writeFileSync(path.join(dist, "_redirects"), "/templates/:id  /editor/?id=:id  301\n");

const files = fs.readdirSync(dist, { recursive: true }).length;
console.log(`\nStatic site written to ${dist} (${files} files).`);
console.log(`Backend address in config.js: ${apiUrl || "(empty: http://localhost:8000)"}`);
