import { encode } from 'uqr';

/** Draws `text` as a QR code on a white square with its quiet zone: black on white, 14 px modules, readable across a room. */
export function drawQr(canvas: HTMLCanvasElement, text: string): void {
  const px = 14;
  const { data, size } = encode(text, { ecc: 'M', border: 4 });
  canvas.width = canvas.height = size * px;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#000';
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (data[y][x]) ctx.fillRect(x * px, y * px, px, px);
}
