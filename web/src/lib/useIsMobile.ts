"use client";

import { useEffect, useState } from "react";

// Matches the Tailwind `lg` breakpoint (<1024px = mobile/compact). Used where a
// decision can't be expressed in CSS — e.g. swapping three.js globe quality.
const MOBILE_QUERY = "(max-width: 1023px)";

export function useIsMobile(): boolean {
  // false on the server / first paint; corrected on mount. Globe is client-only
  // (ssr:false), so it reads the real value on its very first render.
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia(MOBILE_QUERY).matches,
  );

  useEffect(() => {
    const mql = window.matchMedia(MOBILE_QUERY);
    const onChange = () => setIsMobile(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}
