const JFIF_APP0 = Uint8Array.of(
  0xff, 0xe0, 0x00, 0x10, // Marker and segment length
  0x4a, 0x46, 0x49, 0x46, 0x00, // JFIF identifier
  0x01, 0x01, 0x01, // Version 1.01 and density units in inches
  0x00, 0x01, 0x00, 0x01, 0x00, 0x00 // Densities and thumbnail size
);

export function setJpegDensity(bytes, pixelsPerInch) {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new TypeError('No se pudo crear un JPG válido.');
  if (!Number.isInteger(pixelsPerInch) || pixelsPerInch < 1 || pixelsPerInch > 65535) {
    throw new RangeError('La resolución del JPG no es válida.');
  }

  const segmentLength = (bytes[4] << 8) | bytes[5];
  const hasJfif = bytes[2] === 0xff && bytes[3] === 0xe0 && segmentLength >= 16 &&
    bytes.length >= 4 + segmentLength && JFIF_APP0.subarray(4, 9).every((value, index) => bytes[index + 6] === value);
  if (!hasJfif) {
    const result = new Uint8Array(bytes.length + JFIF_APP0.length);
    result.set(bytes.subarray(0, 2));
    result.set(JFIF_APP0, 2);
    result.set(bytes.subarray(2), 2 + JFIF_APP0.length);
    bytes = result;
  }

  bytes[13] = 1;
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  header.setUint16(14, pixelsPerInch);
  header.setUint16(16, pixelsPerInch);
  return bytes;
}

export async function encodeJpeg(canvas, pixelsPerInch) {
  const blob = await new Promise((resolve, reject) => {
    canvas.toBlob(result => {
      if (result) resolve(result);
      else reject(new Error('No se pudo codificar la imagen JPG.'));
    }, 'image/jpeg', 0.96);
  });
  return setJpegDensity(new Uint8Array(await blob.arrayBuffer()), pixelsPerInch);
}
