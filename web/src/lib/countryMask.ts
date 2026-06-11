"use client";

import { feature } from "topojson-client";
import * as THREE from "three";
// Free, public-domain Natural Earth country polygons (110m).
import topo from "world-atlas/countries-110m.json";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let collection: any = null;
function features() {
  if (!collection) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    collection = feature(topo as any, (topo as any).objects.countries);
  }
  return collection.features;
}

// Our country names → Natural Earth (world-atlas) names where they differ.
// Names not present at 110m (Singapore, Hong Kong, Bahrain) just return null
// and the globe falls back to a tight circular spotlight (fine for a city-state).
const NAME_ALIASES: Record<string, string> = {
  "united states": "united states of america",
  "czech republic": "czechia",
};

const cache = new Map<string, THREE.CanvasTexture | null>();

/**
 * Rasterise a country's real border into an equirectangular mask (white inside,
 * black outside, soft blurred edge). lng/lat -> pixel uses the SAME convention
 * the globe shader samples with: u=(lng+180)/360, v=(90-lat)/180. flipY=false so
 * texture2D(mask, vec2(u,v)) reads canvas pixel (u*W, v*H) directly.
 * Returns null if the country isn't found (caller falls back to a spotlight).
 */
export function buildCountryMask(name: string): THREE.CanvasTexture | null {
  if (cache.has(name)) return cache.get(name)!;
  const lower = NAME_ALIASES[name.toLowerCase()] ?? name.toLowerCase();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const feat = features().find(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (f: any) => String(f.properties?.name ?? "").toLowerCase() === lower,
  );
  if (!feat) {
    cache.set(name, null);
    return null;
  }

  const W = 2048;
  const H = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, W, H);
  ctx.filter = "blur(3px)"; // soft falloff at the border
  ctx.fillStyle = "#fff";

  const drawRing = (ring: number[][]) => {
    // Skip rings that cross the antimeridian (e.g. Alaska's Aleutians) — they'd
    // smear a band across the equirectangular map.
    const lngs = ring.map((p) => p[0]);
    if (Math.max(...lngs) - Math.min(...lngs) > 180) return;
    ctx.beginPath();
    ring.forEach(([lng, lat], i) => {
      const x = ((lng + 180) / 360) * W;
      const y = ((90 - lat) / 180) * H;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
    ctx.fill();
  };

  const geom = feat.geometry;
  const polys: number[][][][] =
    geom.type === "Polygon" ? [geom.coordinates] : geom.coordinates;
  for (const poly of polys) for (const ring of poly) drawRing(ring);

  const tex = new THREE.CanvasTexture(canvas);
  tex.flipY = false;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  cache.set(name, tex);
  return tex;
}
