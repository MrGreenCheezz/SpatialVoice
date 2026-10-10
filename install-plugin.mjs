// Copies the plugin into a Vencord source checkout: node install-plugin.mjs [path/to/Vencord]
// (A symlink doesn't work: esbuild resolves it to the real path and loses Vencord's import aliases.)
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const vencord = resolve(process.argv[2] ?? join(here, "..", "Vencord"));
if (!existsSync(join(vencord, "src", "plugins"))) {
    console.error(`Not a Vencord checkout: ${vencord}`);
    process.exit(1);
}

const target = join(vencord, "src", "userplugins", "spatialVoice");
rmSync(target, { recursive: true, force: true });
cpSync(join(here, "plugin", "spatialVoice"), target, { recursive: true });
console.log(`Copied to ${target}`);
