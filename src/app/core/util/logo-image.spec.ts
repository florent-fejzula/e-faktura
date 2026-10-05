import { LOGO_BOUNDS, LOGO_MAX_LENGTH, LogoError, fitWithin, prepareLogo } from './logo-image';

/** A PNG file drawn on a canvas, so the tests need no fixtures on disk. */
async function pngFile(width: number, height: number, noise = false): Promise<File> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d')!;
  if (noise) {
    // Random pixels are the worst case for compression — a stand-in for a
    // photograph used as a logo.
    const pixels = context.createImageData(width, height);
    for (let i = 0; i < pixels.data.length; i++) pixels.data[i] = (Math.random() * 256) | 0;
    context.putImageData(pixels, 0, 0);
  } else {
    context.fillStyle = '#c62828';
    context.fillRect(0, 0, width / 2, height);
  }
  const blob = await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b!), 'image/png'));
  return new File([blob], 'logo.png', { type: 'image/png' });
}

async function decodedSize(dataUrl: string): Promise<{ width: number; height: number }> {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  return { width: image.naturalWidth, height: image.naturalHeight };
}

describe('fitting a logo', () => {
  it('shrinks to the bounds, keeping proportions', () => {
    expect(fitWithin(3000, 1000)).toEqual({ width: 960, height: 320 });
    expect(fitWithin(1000, 1000)).toEqual({ width: 320, height: 320 });
  });

  it('never enlarges a raster image', () => {
    expect(fitWithin(200, 50)).toEqual({ width: 200, height: 50 });
  });

  it('scales a vector up to the bounds', () => {
    expect(fitWithin(120, 40, LOGO_BOUNDS, true)).toEqual({ width: 960, height: 320 });
  });
});

describe('preparing an uploaded logo', () => {
  it('turns a large image into a modest PNG within the bounds', async () => {
    const logo = await prepareLogo(await pngFile(2400, 800));
    expect(logo.dataUrl.startsWith('data:image/png;base64,')).toBeTrue();
    expect([logo.width, logo.height]).toEqual([960, 320]);
    expect(await decodedSize(logo.dataUrl)).toEqual({ width: 960, height: 320 });
  });

  it('leaves a small image at its own size', async () => {
    const logo = await prepareLogo(await pngFile(300, 100));
    expect([logo.width, logo.height]).toEqual([300, 100]);
  });

  it('draws an SVG that only has a viewBox at full size, unsquashed', async () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 100">' +
      '<rect width="150" height="100" fill="#1565c0"/></svg>';
    const logo = await prepareLogo(new File([svg], 'logo.svg', { type: 'image/svg+xml' }));
    expect([logo.width, logo.height]).toEqual([960, 320]);
    expect(logo.dataUrl.startsWith('data:image/png;base64,')).toBeTrue();
  });

  it('keeps a photographic logo under the size the rules accept', async () => {
    const logo = await prepareLogo(await pngFile(960, 320, true));
    expect(logo.dataUrl.length).toBeLessThanOrEqual(LOGO_MAX_LENGTH);
    expect(logo.dataUrl).toMatch(/^data:image\/(png|webp|jpeg);base64,/);
  });

  it('refuses something that is not an image, in Macedonian', async () => {
    const text = new File(['not an image'], 'notes.txt', { type: 'text/plain' });
    await expectAsync(prepareLogo(text)).toBeRejectedWithError(LogoError, /PNG, JPG, WebP или SVG/);
  });

  it('refuses an image file that does not decode', async () => {
    const broken = new File([new Uint8Array([1, 2, 3, 4])], 'logo.png', { type: 'image/png' });
    await expectAsync(prepareLogo(broken)).toBeRejectedWithError(LogoError);
  });
});
