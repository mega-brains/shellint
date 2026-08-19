#!/usr/bin/env node
import { mkdirSync, existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

if (!process.env.SHELLINT_SCRIPT?.trim()) {
  const script = path.join(root, "scripts", "main.ts");
  if (!existsSync(script)) {
    const template = readFileSync(path.join(root, "templates", "main.example.ts"), "utf8");
    mkdirSync(path.dirname(script), { recursive: true });
    const temporary = path.join(path.dirname(script), ".main.example.ts.tmp");
    writeFileSync(temporary, template, "utf8");
    renameSync(temporary, script);
  }
}
