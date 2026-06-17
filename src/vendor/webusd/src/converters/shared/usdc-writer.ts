/** WebUsdFramework.Converters.Shared.UsdcWriter — Pixar Crate (USDC) binary layer encoder
 *
 * SCAFFOLD ONLY. This module provides the container-level building blocks for
 * USDC ("Crate") layer files: the 88-byte bootstrap header and the table-of-
 * contents structure. The actual section encoders (TOKENS, STRINGS, FIELDS,
 * FIELDSETS, PATHS, SPECS), ValueRep encoding, and LZ4 array compression are
 * intentionally NOT included — they will land in subsequent PRs that build on
 * this foundation.
 *
 * The functions in this module are pure: no I/O, no allocation beyond the
 * caller-provided DataView. The module is currently exported but NOT wired
 * into the converter pipeline.
 *
 * Reference: `pxr/usd/usd/crateFile.{h,cpp}` from the OpenUSD source tree.
 */

/**
 * Magic identifier at the start of every USDC file: ASCII `PXR-USDC`.
 */
export const USDC_MAGIC: ReadonlyArray<number> = Object.freeze([
  0x50, 0x58, 0x52, 0x2d, 0x55, 0x53, 0x44, 0x43, // 'P','X','R','-','U','S','D','C'
]);

/**
 * Total byte length of the bootstrap header.
 *
 * Layout:
 *   [ 0 ..  8) ident       — `PXR-USDC` magic
 *   [ 8 .. 16) version     — `[major, minor, patch, 0, 0, 0, 0, 0]`
 *   [16 .. 24) tocOffset   — int64 little-endian (file offset to the TOC)
 *   [24 .. 88) reserved    — 64 bytes, zero-filled
 */
export const USDC_BOOTSTRAP_SIZE = 88;

/**
 * Number of bytes a TOC section name occupies, including the trailing null
 * terminator. Section names longer than 15 characters will be truncated.
 */
export const USDC_SECTION_NAME_SIZE = 16;

/**
 * Byte length of a single TOC section entry:
 *   { name[16], start: int64, size: int64 }
 */
export const USDC_TOC_ENTRY_SIZE = USDC_SECTION_NAME_SIZE + 8 + 8;

/**
 * Pixar Crate file format version targeted by this writer.
 *
 * The default is conservative (0.8.0) so the foundation works with the widest
 * range of USD readers. Subsequent PRs that add ValueRep coverage may bump the
 * default if they introduce features that require a newer version.
 */
export interface UsdcVersion {
  major: number;
  minor: number;
  patch: number;
}

export const USDC_DEFAULT_VERSION: Readonly<UsdcVersion> = Object.freeze({
  major: 0,
  minor: 8,
  patch: 0,
});

/**
 * Description of one section in the table of contents.
 */
export interface UsdcSection {
  /** ASCII section name, e.g. `TOKENS`, `STRINGS`, `FIELDS`. Max 15 chars. */
  name: string;
  /** Absolute byte offset of the section's payload from the start of the file. */
  start: number;
  /** Byte length of the section's payload as it appears on disk. */
  size: number;
}

/**
 * Write the 88-byte bootstrap header starting at `offset` in `view`.
 *
 * The caller owns the underlying buffer and must ensure `view` has at least
 * `offset + USDC_BOOTSTRAP_SIZE` bytes available. The function performs no
 * allocation.
 *
 * @returns The byte offset immediately after the bootstrap (`offset + 88`).
 * @throws RangeError if the write would fall outside `view`.
 */
export function writeBootstrap(
  view: DataView,
  offset: number,
  tocOffset: number,
  version: UsdcVersion = USDC_DEFAULT_VERSION
): number {
  if (offset < 0 || offset + USDC_BOOTSTRAP_SIZE > view.byteLength) {
    throw new RangeError(
      `writeBootstrap: out of bounds (need ${USDC_BOOTSTRAP_SIZE} bytes at offset ${offset}, have ${view.byteLength - offset})`
    );
  }
  if (tocOffset < 0 || !Number.isInteger(tocOffset)) {
    throw new RangeError(`writeBootstrap: tocOffset must be a non-negative integer (got ${tocOffset})`);
  }

  // Magic: "PXR-USDC"
  for (let i = 0; i < USDC_MAGIC.length; i++) {
    view.setUint8(offset + i, USDC_MAGIC[i]);
  }

  // Version: [major, minor, patch, 0, 0, 0, 0, 0]
  view.setUint8(offset + 8, version.major & 0xff);
  view.setUint8(offset + 9, version.minor & 0xff);
  view.setUint8(offset + 10, version.patch & 0xff);
  view.setUint8(offset + 11, 0);
  view.setUint8(offset + 12, 0);
  view.setUint8(offset + 13, 0);
  view.setUint8(offset + 14, 0);
  view.setUint8(offset + 15, 0);

  // tocOffset: int64 little-endian
  view.setBigInt64(offset + 16, BigInt(tocOffset), /* littleEndian */ true);

  // Reserved 64 bytes. Zeroed even when the caller hands us a non-zeroed view.
  for (let i = 24; i < USDC_BOOTSTRAP_SIZE; i++) {
    view.setUint8(offset + i, 0);
  }

  return offset + USDC_BOOTSTRAP_SIZE;
}

/**
 * Compute the total byte length of a TOC for a given number of sections.
 *
 * Layout:
 *   uint64 numSections
 *   numSections × { char[16] name, int64 start, int64 size }
 */
export function tocByteLength(sectionCount: number): number {
  if (sectionCount < 0 || !Number.isInteger(sectionCount)) {
    throw new RangeError(`tocByteLength: sectionCount must be a non-negative integer (got ${sectionCount})`);
  }
  return 8 + sectionCount * USDC_TOC_ENTRY_SIZE;
}

/**
 * Write the table-of-contents starting at `offset` in `view`.
 *
 * Layout written:
 *   uint64 little-endian: numSections
 *   for each section:
 *     char[16]:            section name, ASCII, null-padded to 16 bytes
 *     int64 little-endian: start
 *     int64 little-endian: size
 *
 * @returns The byte offset immediately after the TOC.
 * @throws RangeError if the write would fall outside `view`, if a section
 *   name contains non-ASCII characters, or if a section has a negative
 *   `start` or `size`.
 */
export function writeTOC(
  view: DataView,
  offset: number,
  sections: ReadonlyArray<UsdcSection>
): number {
  const required = tocByteLength(sections.length);
  if (offset < 0 || offset + required > view.byteLength) {
    throw new RangeError(
      `writeTOC: out of bounds (need ${required} bytes at offset ${offset}, have ${view.byteLength - offset})`
    );
  }

  // Validate every section before emitting any bytes so a partial write
  // cannot leave a half-encoded TOC in the buffer.
  const nameMax = USDC_SECTION_NAME_SIZE - 1;
  for (const section of sections) {
    if (!Number.isInteger(section.start) || section.start < 0) {
      throw new RangeError(
        `writeTOC: section "${section.name}" has invalid start ${section.start} (must be a non-negative integer)`
      );
    }
    if (!Number.isInteger(section.size) || section.size < 0) {
      throw new RangeError(
        `writeTOC: section "${section.name}" has invalid size ${section.size} (must be a non-negative integer)`
      );
    }
    const nameLen = Math.min(section.name.length, nameMax);
    for (let i = 0; i < nameLen; i++) {
      const code = section.name.charCodeAt(i);
      if (code < 0x20 || code > 0x7e) {
        throw new RangeError(
          `writeTOC: section name "${section.name}" contains non-ASCII char at position ${i}`
        );
      }
    }
  }

  // numSections (uint64 little-endian)
  view.setBigUint64(offset, BigInt(sections.length), /* littleEndian */ true);
  let cursor = offset + 8;

  for (const section of sections) {
    // name: up to 15 ASCII bytes, null-terminated, zero-padded to 16 bytes
    for (let i = 0; i < USDC_SECTION_NAME_SIZE; i++) {
      const ch = i < section.name.length && i < nameMax ? section.name.charCodeAt(i) : 0;
      view.setUint8(cursor + i, ch & 0xff);
    }
    cursor += USDC_SECTION_NAME_SIZE;

    // start (int64 little-endian)
    view.setBigInt64(cursor, BigInt(section.start), true);
    cursor += 8;

    // size (int64 little-endian)
    view.setBigInt64(cursor, BigInt(section.size), true);
    cursor += 8;
  }

  return cursor;
}
