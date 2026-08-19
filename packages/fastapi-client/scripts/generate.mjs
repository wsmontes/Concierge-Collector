import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import openapiTS, { astToString } from "openapi-typescript";

const snapshot = new URL("../../../contracts/openapi/fastapi-admin-internal.v1.json", import.meta.url);
const output = new URL("../src/generated.ts", import.meta.url);
const check = process.argv.includes("--check");

const generated = `${astToString(await openapiTS(snapshot))}\n`;

if (check) {
  let existing = "";
  try {
    existing = await readFile(output, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (existing !== generated) {
    process.stderr.write(`Generated FastAPI client is stale: ${fileURLToPath(output)}\n`);
    process.exitCode = 1;
  }
} else {
  await mkdir(new URL("../src/", import.meta.url), { recursive: true });
  await writeFile(output, generated, "utf8");
}
