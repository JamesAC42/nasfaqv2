"use client";

import { useEffect, useState } from "react";
import type { ArtAnchors } from "@/app/lib/art-manifest";

// Transparent cutouts (key art, reactions) are drawn with their crop edges faded into the page, so a
// waist cut or a braid clipped by the source frame never shows as a hard line. The pipeline can send
// `anchors.content_box` + `anchors.cut`; when it doesn't, the image's alpha is measured once in the
// browser (same-origin or CORS-enabled art only) and the result is cached per URL.

export type CutoutShape = {
  /** Opaque bounding box, fractions of the image: [x0, y0, x1, y1]. */
  box: [number, number, number, number];
  /** Edges where the figure is cut by the frame (a straight run of opaque pixels). */
  cut: { top?: boolean; bottom?: boolean; left?: boolean; right?: boolean };
};

const cache = new Map<string, CutoutShape | null>();
const pending = new Map<string, Promise<CutoutShape | null>>();

function measure(url: string): Promise<CutoutShape | null> {
  const known = cache.get(url);
  if (known !== undefined) return Promise.resolve(known);
  const running = pending.get(url);
  if (running) return running;
  const job = new Promise<CutoutShape | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => {
      try {
        const scale = Math.min(1, 240 / img.naturalWidth);
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0, w, h);
        const data = ctx.getImageData(0, 0, w, h).data;
        const opaque = (x: number, y: number) => data[(y * w + x) * 4 + 3] > 40;
        let x0 = w, y0 = h, x1 = -1, y1 = -1;
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            if (!opaque(x, y)) continue;
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
        if (x1 < 0) return resolve(null);
        // A crop line is a straight run of opaque pixels along the box edge; a natural silhouette
        // (hair, a shoulder) only touches its extreme row/column at a few points.
        const row = (y: number) => {
          let n = 0;
          for (let x = x0; x <= x1; x++) if (opaque(x, y)) n++;
          return n / (x1 - x0 + 1);
        };
        const col = (x: number) => {
          let n = 0;
          for (let y = y0; y <= y1; y++) if (opaque(x, y)) n++;
          return n / (y1 - y0 + 1);
        };
        const edgeRow = (y: number) => Math.max(row(y), row(Math.max(y0, Math.min(y1, y + (y === y1 ? -1 : 1)))));
        const edgeCol = (x: number) => Math.max(col(x), col(Math.max(x0, Math.min(x1, x + (x === x1 ? -1 : 1)))));
        resolve({
          box: [x0 / w, y0 / h, (x1 + 1) / w, (y1 + 1) / h],
          cut: { bottom: edgeRow(y1) > 0.3, top: edgeRow(y0) > 0.45, left: edgeCol(x0) > 0.14, right: edgeCol(x1) > 0.14 },
        });
      } catch {
        resolve(null); // tainted canvas (art on another origin without CORS): no measurement
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  }).then((shape) => {
    cache.set(url, shape);
    pending.delete(url);
    return shape;
  });
  pending.set(url, job);
  return job;
}

type ShapeAnchors = ArtAnchors & { content_box?: [number, number, number, number]; cut?: string[] };

/** The cutout's shape from the pipeline's anchors, else measured from the image (null until known). */
export function useCutoutShape(url: string | null, anchors: ShapeAnchors | undefined): CutoutShape | null {
  const fromAnchors: CutoutShape | null =
    anchors?.content_box && anchors.cut
      ? { box: anchors.content_box, cut: Object.fromEntries(anchors.cut.map((edge) => [edge, true])) as CutoutShape["cut"] }
      : null;
  const hasAnchors = fromAnchors !== null;
  const [measured, setMeasured] = useState<{ url: string; shape: CutoutShape | null } | null>(null);
  useEffect(() => {
    if (!url || hasAnchors) return;
    let alive = true;
    void measure(url).then((shape) => {
      if (alive) setMeasured({ url, shape });
    });
    return () => {
      alive = false;
    };
  }, [url, hasAnchors]);
  if (fromAnchors) return fromAnchors;
  if (url && cache.has(url)) return cache.get(url) ?? null;
  return measured && measured.url === url ? measured.shape : null;
}

const svg = (w: number, h: number, dir: "down" | "up" | "right" | "left", from: number, to: number) => {
  // An SVG with the image's aspect ratio, so `mask-size: contain` lines it up with an object-fit
  // contained image exactly. `from`/`to` are fractions along `dir` where the fade starts/ends.
  const [x1, y1, x2, y2] = dir === "down" ? [0, 0, 0, 1] : dir === "up" ? [0, 1, 0, 0] : dir === "right" ? [0, 0, 1, 0] : [1, 0, 0, 0];
  const body = `<svg xmlns='http://www.w3.org/2000/svg' width='${w}' height='${h}' viewBox='0 0 ${w} ${h}' preserveAspectRatio='none'><defs><linearGradient id='g' x1='${x1}' y1='${y1}' x2='${x2}' y2='${y2}'><stop offset='${from.toFixed(3)}' stop-color='#fff'/><stop offset='${to.toFixed(3)}' stop-color='#fff' stop-opacity='0'/></linearGradient></defs><rect width='${w}' height='${h}' fill='url(#g)'/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(body)}")`;
};

/**
 * Mask style that fades every cut edge of a cutout into the page. `length` is the fade length as a
 * fraction of the figure's height (bottom) or width (sides). `defaultBottom` fades the bottom even
 * before the shape is known (waist-up art is always cut there).
 */
export function cutoutMask(
  shape: CutoutShape | null,
  image: { w: number; h: number },
  { length = 0.22, defaultBottom = true, fit = "contain", position = "50% 100%" }: { length?: number; defaultBottom?: boolean; fit?: string; position?: string } = {},
): React.CSSProperties | undefined {
  const layers: string[] = [];
  const [x0, y0, x1, y1] = shape?.box ?? [0, 0, 1, 1];
  const figH = y1 - y0;
  const figW = x1 - x0;
  if (shape ? shape.cut.bottom : defaultBottom) layers.push(svg(image.w, image.h, "down", Math.max(y0, y1 - figH * length), y1));
  // Side and top cuts fade over a shorter run so the figure keeps its width.
  if (shape?.cut.right) layers.push(svg(image.w, image.h, "right", Math.max(x0, x1 - figW * length * 0.6), x1));
  if (shape?.cut.left) layers.push(svg(image.w, image.h, "left", Math.max(0, 1 - x0 - figW * length * 0.6), 1 - x0));
  // Tops are cut by hats, ears and headdresses right above the hair line: keep that fade short.
  if (shape?.cut.top) layers.push(svg(image.w, image.h, "up", Math.max(0, 1 - y0 - figH * length * 0.22), 1 - y0));
  if (!layers.length) return undefined;
  const size = fit === "cover" ? "cover" : "contain";
  const image_ = layers.join(", ");
  return {
    WebkitMaskImage: image_,
    maskImage: image_,
    WebkitMaskSize: size,
    maskSize: size,
    WebkitMaskPosition: position,
    maskPosition: position,
    WebkitMaskRepeat: "no-repeat",
    maskRepeat: "no-repeat",
    WebkitMaskComposite: "source-in",
    maskComposite: "intersect",
  } as React.CSSProperties;
}
