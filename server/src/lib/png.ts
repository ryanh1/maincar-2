const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

// The chunks needed to render a PNG. Text, EXIF, timestamps, and arbitrary
// ancillary chunks are deliberately dropped before an avatar is persisted.
const KEEP_CHUNKS = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND', 'tRNS', 'gAMA', 'cHRM', 'sRGB', 'sBIT', 'bKGD', 'pHYs'])

export function sanitizePng(bytes: Buffer): Buffer | null {
  if (bytes.length <= PNG_SIGNATURE.length || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return null

  const kept: Buffer[] = [PNG_SIGNATURE]
  let hasHeader = false
  let offset = PNG_SIGNATURE.length

  while (offset + 8 <= bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const type = bytes.toString('ascii', offset + 4, offset + 8)
    const end = offset + 12 + length
    if (length > bytes.length || end > bytes.length) return null
    if (type === 'IHDR') {
      if (length < 8) return null
      hasHeader = true
    }
    if (KEEP_CHUNKS.has(type)) kept.push(bytes.subarray(offset, end))
    offset = end
    if (type === 'IEND') return hasHeader ? Buffer.concat(kept) : null
  }

  return null
}
