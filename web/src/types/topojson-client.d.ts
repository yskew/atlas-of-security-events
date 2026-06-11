// `topojson-client` ships no type declarations and we only use `feature()` in
// countryMask.ts. This ambient module declaration types it loosely so the
// production build (`next build` / Vercel) doesn't fail with TS7016.
declare module "topojson-client";
