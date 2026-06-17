// Stub for Node builtins and native/optional deps that the vendored converter
// references but never actually executes on the GLB->USDZ Blob path in the
// browser. Members below cover the few that appear in dead branches
// (debug output, file streaming, vertex-color baking) so a stray reference
// can't throw at runtime.
/* eslint-disable @typescript-eslint/no-explicit-any */
export class Writable {}
export const constants = { F_OK: 0 };
export function writeFileSync(): void {}
export function mkdirSync(): void {}
export function mkdtempSync(): string {
  return "/tmp";
}
export function createWriteStream(): any {
  return { on() {}, write() {}, end() {}, once() {} };
}
export function statSync(): any {
  return { size: 0 };
}
export function existsSync(): boolean {
  return false;
}
export function readFileSync(): Uint8Array {
  return new Uint8Array();
}
export function readdirSync(): string[] {
  return [];
}
export function rmSync(): void {}
export function unlinkSync(): void {}
export function lstatSync(): any {
  return { size: 0, isDirectory: () => false, isFile: () => true };
}
export function accessSync(): void {}
export const join = (...a: string[]): string => a.join("/");
export const resolve = (...a: string[]): string => a.join("/");
export const dirname = (p: string): string =>
  p.split("/").slice(0, -1).join("/");
export const basename = (p: string): string => p.split("/").pop() || "";
export const extname = (p: string): string => {
  const b = basename(p);
  const i = b.lastIndexOf(".");
  return i > 0 ? b.slice(i) : "";
};
export const tmpdir = (): string => "/tmp";

export default {
  Writable,
  constants,
  writeFileSync,
  mkdirSync,
  mkdtempSync,
  createWriteStream,
  statSync,
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  lstatSync,
  accessSync,
  join,
  resolve,
  dirname,
  basename,
  extname,
  tmpdir,
};
