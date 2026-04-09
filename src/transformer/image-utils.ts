/**
 * Image utilities for transform command
 * Reads image dimensions from file headers without external dependencies
 */

import fs from 'fs/promises';

/**
 * Get image dimensions by reading file headers
 * Supports PNG, JPEG, WebP, GIF, BMP
 */
export async function getImageDimensions(
  filePath: string
): Promise<{ width: number; height: number }> {
  const fd = await fs.open(filePath, 'r');
  try {
    const header = Buffer.alloc(30);
    await fd.read(header, 0, 30, 0);

    // PNG: bytes 16-23 contain width and height as 4-byte big-endian
    if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4e && header[3] === 0x47) {
      const width = header.readUInt32BE(16);
      const height = header.readUInt32BE(20);
      return { width, height };
    }

    // JPEG: need to scan for SOF marker
    if (header[0] === 0xff && header[1] === 0xd8) {
      return await readJpegDimensions(fd);
    }

    // WebP: RIFF header + VP8 chunk
    if (
      header[0] === 0x52 &&
      header[1] === 0x49 &&
      header[2] === 0x46 &&
      header[3] === 0x46 &&
      header[8] === 0x57 &&
      header[9] === 0x45 &&
      header[10] === 0x42 &&
      header[11] === 0x50
    ) {
      return await readWebpDimensions(fd);
    }

    // GIF: bytes 6-9 contain width and height as 2-byte little-endian
    if (header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46) {
      const width = header.readUInt16LE(6);
      const height = header.readUInt16LE(8);
      return { width, height };
    }

    // BMP: bytes 18-25 contain width and height as 4-byte little-endian
    if (header[0] === 0x42 && header[1] === 0x4d) {
      const width = header.readInt32LE(18);
      const height = Math.abs(header.readInt32LE(22));
      return { width, height };
    }

    throw new Error(`Unsupported image format: ${filePath}`);
  } finally {
    await fd.close();
  }
}

/**
 * Read JPEG dimensions by scanning for SOF marker
 */
async function readJpegDimensions(fd: fs.FileHandle): Promise<{ width: number; height: number }> {
  let offset = 2;
  const buf = Buffer.alloc(10);

  for (let i = 0; i < 100; i++) {
    const { bytesRead } = await fd.read(buf, 0, 4, offset);
    if (bytesRead < 4) break;

    if (buf[0] !== 0xff) break;

    const marker = buf[1];

    // SOF markers (0xC0-0xCF except 0xC4 DHT, 0xC8 reserved, 0xCC DAC)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      await fd.read(buf, 0, 7, offset + 2);
      const height = buf.readUInt16BE(1);
      const width = buf.readUInt16BE(3);
      return { width, height };
    }

    // Read segment length and skip
    const segLen = buf.readUInt16BE(2);
    offset += 2 + segLen;
  }

  throw new Error('Could not find JPEG SOF marker');
}

/**
 * Read WebP dimensions
 */
async function readWebpDimensions(fd: fs.FileHandle): Promise<{ width: number; height: number }> {
  const buf = Buffer.alloc(30);
  await fd.read(buf, 0, 30, 0);

  const chunk = buf.toString('ascii', 12, 16);

  // VP8 lossy
  if (chunk === 'VP8 ') {
    // Frame tag at offset 23, then width/height at 26/28
    const frameBuf = Buffer.alloc(10);
    await fd.read(frameBuf, 0, 10, 20);
    const width = frameBuf.readUInt16LE(6) & 0x3fff;
    const height = frameBuf.readUInt16LE(8) & 0x3fff;
    return { width, height };
  }

  // VP8L lossless
  if (chunk === 'VP8L') {
    const b = Buffer.alloc(5);
    await fd.read(b, 0, 5, 21);
    const bits = b.readUInt32LE(0);
    const width = (bits & 0x3fff) + 1;
    const height = ((bits >> 14) & 0x3fff) + 1;
    return { width, height };
  }

  // VP8X extended
  if (chunk === 'VP8X') {
    const b = Buffer.alloc(10);
    await fd.read(b, 0, 10, 20);
    const width = (b[4] | (b[5] << 8) | (b[6] << 16)) + 1;
    const height = (b[7] | (b[8] << 8) | (b[9] << 16)) + 1;
    return { width, height };
  }

  throw new Error('Unsupported WebP format');
}
