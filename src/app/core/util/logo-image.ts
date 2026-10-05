/**
 * Turning whatever image a customer uploads into a logo fit to store.
 *
 * Everything is redrawn on a canvas in the browser, so what is stored is always
 * a modest PNG (or WebP/JPEG for a photographic logo) no matter what came in —
 * a 6 MB camera photo and a 2 KB SVG come out the same size class. SVG is
 * rasterised too: the invoice is printed from an image either way, and a
 * stored SVG would be a document that can carry markup of its own.
 */

/**
 * Pixel bounds of a stored logo. The invoice prints a logo at most about
 * 85 × 23 mm, and these keep it sharp at 300 dpi at that size.
 */
export const LOGO_BOUNDS = { width: 960, height: 320 } as const;

/** Budget for the stored data URL; the security rules refuse anything over 350 000. */
export const LOGO_MAX_LENGTH = 300_000;

const MAX_INPUT_BYTES = 10 * 1024 * 1024;

const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'];

/** A failure worth showing to the person uploading, in their language. */
export class LogoError extends Error {}

export interface PreparedLogo {
  dataUrl: string;
  width: number;
  height: number;
}

/**
 * The largest size with the same proportions that fits the bounds. Raster
 * images are never enlarged — that only adds blur — but a vector can be drawn
 * at any size, so SVG is scaled up to the bounds.
 */
export function fitWithin(
  width: number,
  height: number,
  bounds: { width: number; height: number } = LOGO_BOUNDS,
  allowUpscale = false,
): { width: number; height: number } {
  const scale = Math.min(bounds.width / width, bounds.height / height, allowUpscale ? Infinity : 1);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export async function prepareLogo(file: File): Promise<PreparedLogo> {
  if (!ACCEPTED_TYPES.includes(file.type)) {
    throw new LogoError('Изберете слика во PNG, JPG, WebP или SVG формат.');
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new LogoError('Сликата е поголема од 10 MB.');
  }

  const isSvg = file.type === 'image/svg+xml';
  const source = isSvg ? await sizedSvg(file) : file;
  const url = URL.createObjectURL(source);
  try {
    const image = await loadImage(url);
    const size = fitWithin(image.naturalWidth, image.naturalHeight, LOGO_BOUNDS, isSvg);

    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext('2d');
    if (!context) throw new LogoError('Прелистувачот не може да ја обработи сликата.');
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(image, 0, 0, size.width, size.height);

    return { dataUrl: encode(canvas), ...size };
  } catch (error) {
    // An SVG that embeds outside content can leave the canvas unreadable.
    if (error instanceof LogoError) throw error;
    throw new LogoError('Сликата не може да се обработи. Пробајте PNG.');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () =>
      image.naturalWidth > 0 && image.naturalHeight > 0
        ? resolve(image)
        : reject(new LogoError('Сликата нема големина што може да се прочита.'));
    image.onerror = () => reject(new LogoError('Сликата не може да се прочита.'));
    image.src = url;
  });
}

/**
 * An SVG with an explicit pixel size at the logo bounds.
 *
 * Logos are often exported with only a `viewBox`, and an image without an
 * intrinsic size is drawn at the browser's 300 × 150 default — squashed. The
 * proportions come from the `viewBox` (or the width/height it already has)
 * and the size is written onto the root element before it is drawn.
 */
async function sizedSvg(file: File): Promise<Blob> {
  const parsed = new DOMParser().parseFromString(await file.text(), 'image/svg+xml');
  const svg = parsed.documentElement;
  if (svg.nodeName !== 'svg' || parsed.getElementsByTagName('parsererror').length) {
    throw new LogoError('SVG датотеката не може да се прочита.');
  }

  const viewBox = (svg.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number);
  const hasViewBox = viewBox.length === 4 && viewBox[2] > 0 && viewBox[3] > 0;
  const width = hasViewBox ? viewBox[2] : parseFloat(svg.getAttribute('width') ?? '');
  const height = hasViewBox ? viewBox[3] : parseFloat(svg.getAttribute('height') ?? '');
  if (!(width > 0) || !(height > 0)) {
    throw new LogoError('SVG датотеката нема големина. Зачувајте ја со viewBox или ширина и висина.');
  }

  if (!hasViewBox) svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const size = fitWithin(width, height, LOGO_BOUNDS, true);
  svg.setAttribute('width', String(size.width));
  svg.setAttribute('height', String(size.height));
  return new Blob([new XMLSerializer().serializeToString(parsed)], { type: 'image/svg+xml' });
}

/**
 * Lossless first: logos are flat colour and sharp edges, which PNG keeps
 * exactly and compactly. Only a photographic logo outgrows it, and then WebP
 * keeps the transparency at a fraction of the size. JPEG is the last resort,
 * on white — the colour of the paper, so the lost transparency does not show.
 */
function encode(canvas: HTMLCanvasElement): string {
  const png = canvas.toDataURL('image/png');
  if (png.length <= LOGO_MAX_LENGTH) return png;

  for (const quality of [0.9, 0.75]) {
    const webp = canvas.toDataURL('image/webp', quality);
    // Browsers that cannot encode WebP quietly return a PNG instead.
    if (webp.startsWith('data:image/webp') && webp.length <= LOGO_MAX_LENGTH) return webp;
  }

  const flat = document.createElement('canvas');
  flat.width = canvas.width;
  flat.height = canvas.height;
  const context = flat.getContext('2d');
  if (context) {
    context.fillStyle = '#fff';
    context.fillRect(0, 0, flat.width, flat.height);
    context.drawImage(canvas, 0, 0);
    for (const quality of [0.85, 0.7]) {
      const jpeg = flat.toDataURL('image/jpeg', quality);
      if (jpeg.length <= LOGO_MAX_LENGTH) return jpeg;
    }
  }

  throw new LogoError('Сликата е премногу сложена за лого. Пробајте поедноставна верзија.');
}
