// fs.cpSync crashes Node 22 on Windows for paths with non-ASCII characters
// (this repo lives under D:\literature\کتاب\...), so copy files by hand.
import { copyFileSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

export function copyRecursive(src, dst) {
  if (statSync(src).isDirectory()) {
    mkdirSync(dst, { recursive: true });
    for (const name of readdirSync(src)) copyRecursive(join(src, name), join(dst, name));
  } else {
    copyFileSync(src, dst);
  }
}
