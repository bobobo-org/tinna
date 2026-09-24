/**
 * 商品圖片上傳前處理（瀏覽器端）：長邊最多 1600px、重新壓縮，手機拍的大照片也能順利上傳
 * - JPEG → JPEG（品質 0.85）；PNG／WebP → WebP（保留透明；瀏覽器不支援 WebP 輸出時會是 PNG）
 * - GIF 不處理（保留動畫），需小於 5MB
 */

export const MAX_EDGE = 1600;
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/gif';
const OK_TYPES = IMAGE_ACCEPT.split(',');

export async function prepareImage(file: File): Promise<Blob> {
  if (!OK_TYPES.includes(file.type)) throw new Error('只能上傳 JPG、PNG、WebP 或 GIF 圖片');
  if (file.type === 'image/gif') {
    if (file.size > MAX_UPLOAD_BYTES) throw new Error('GIF 圖片請小於 5MB');
    return file;
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    if (file.size <= MAX_UPLOAD_BYTES) return file;
    throw new Error('無法讀取這張圖片');
  }
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.size <= 1.5 * 1024 * 1024) {
    bitmap.close();
    return file;
  }
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    return file;
  }
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  const type = file.type === 'image/jpeg' ? 'image/jpeg' : 'image/webp';
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.85));
  if (!blob) return file;
  if (blob.size > MAX_UPLOAD_BYTES) throw new Error('圖片太大了，請換一張小一點的圖片');
  return blob;
}
