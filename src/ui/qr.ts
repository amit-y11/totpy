// Reads QR codes from an image. Uses the browser's BarcodeDetector where it
// exists (macOS, ChromeOS) and falls back to jsQR elsewhere.

import jsQR from 'jsqr';

// BarcodeDetector is not in TypeScript's DOM types yet.
interface BarcodeDetectorInstance {
  detect(image: ImageBitmapSource): Promise<{ rawValue: string }[]>;
}
interface BarcodeDetectorClass {
  new (options: { formats: string[] }): BarcodeDetectorInstance;
  getSupportedFormats(): Promise<string[]>;
}

async function withBarcodeDetector(bitmap: ImageBitmap): Promise<string[]> {
  const Detector = (globalThis as { BarcodeDetector?: BarcodeDetectorClass }).BarcodeDetector;
  if (!Detector) return [];
  try {
    if (!(await Detector.getSupportedFormats()).includes('qr_code')) return [];
    const codes = await new Detector({ formats: ['qr_code'] }).detect(bitmap);
    return codes.map((c) => c.rawValue);
  } catch {
    return [];
  }
}

function withJsQr(bitmap: ImageBitmap): string[] {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return [];
  ctx.drawImage(bitmap, 0, 0);
  const { data, width, height } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  const result = jsQR(data, width, height, { inversionAttempts: 'attemptBoth' });
  return result ? [result.data] : [];
}

/** Returns the first otpauth:// or otpauth-migration:// link found in `blob`. */
export async function readAccountQr(blob: Blob): Promise<string> {
  const bitmap = await createImageBitmap(blob);
  try {
    const isAccountLink = (v: string) => /^otpauth(-migration)?:/i.test(v);
    const found =
      (await withBarcodeDetector(bitmap)).find(isAccountLink) ??
      withJsQr(bitmap).find(isAccountLink);
    if (!found) throw new Error('No 2FA QR code found');
    return found;
  } finally {
    bitmap.close();
  }
}
