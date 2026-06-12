"use client";

import { Billboard, Stars, Text } from "@react-three/drei";
import { Canvas, useFrame, useLoader, useThree } from "@react-three/fiber";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { Suspense, useCallback, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { buildCountryMask } from "@/lib/countryMask";
import { cityCoord, countryCentroid, hasCoords } from "@/lib/geo";
import { useStore } from "@/lib/store";
import { useIsMobile } from "@/lib/useIsMobile";

const R = 1;
const DEG = Math.PI / 180;

// lat/lng -> 3D point, matching three's SphereGeometry UV convention exactly,
// so a marker lands on its real city on the equirectangular night texture.
function latLngToVec3(lat: number, lng: number, radius = R): THREE.Vector3 {
  const polar = (90 - lat) * DEG; // from north pole
  const azim = (lng + 180) * DEG;
  return new THREE.Vector3(
    -radius * Math.cos(azim) * Math.sin(polar),
    radius * Math.cos(polar),
    radius * Math.sin(azim) * Math.sin(polar),
  );
}

function easeOut(t: number) {
  return 1 - Math.pow(1 - Math.min(t, 1), 3);
}

function Earth({
  meshRef,
  isMobile,
}: {
  meshRef: React.RefObject<THREE.Mesh | null>;
  isMobile: boolean;
}) {
  // Phones load a 4K texture (~0.3MB) instead of the 8K (~3MB) — far less to
  // download and far less GPU memory, while staying crisp even when zoomed into
  // a country on a high-DPI screen.
  const tex = useLoader(
    THREE.TextureLoader,
    isMobile ? "/textures/earth-night-4k.jpg" : "/textures/earth-night-8k.jpg",
  );
  const matRef = useRef<THREE.MeshStandardMaterial>(null);
  const intensity = useRef(0.25);
  const { gl } = useThree();
  const city = useStore((s) => s.city);
  const country = useStore((s) => s.country);
  const events = useStore((s) => s.events);

  useMemo(() => {
    tex.colorSpace = THREE.SRGBColorSpace;
    // Max anisotropic filtering keeps the map crisp at grazing angles / zoom.
    tex.anisotropy = gl.capabilities.getMaxAnisotropy();
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
  }, [tex, gl]);

  // Focus uniforms (stable objects; we mutate .value, never recompile).
  const uniforms = useRef({
    uFocusMode: { value: 0 }, // 0 none, 1 city spotlight, 2 country mask
    uMask: { value: null as THREE.Texture | null },
    uFocusDir: { value: new THREE.Vector3() },
    uInnerCos: { value: 0.999 },
    uOuterCos: { value: 0.99 },
    uDim: { value: 0.1 }, // brightness of everything OUTSIDE the focus region
  });

  // Patch the standard material: keep the focused country/city at full
  // brightness, dim the rest. Country = real border mask; city = tight circle.
  const onBeforeCompile = useCallback((shader: THREE.WebGLProgramParametersWithUniforms) => {
    Object.assign(shader.uniforms, uniforms.current);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vFocusPos;")
      .replace(
        "#include <begin_vertex>",
        "#include <begin_vertex>\nvFocusPos = position;",
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
varying vec3 vFocusPos;
uniform float uFocusMode; uniform sampler2D uMask; uniform vec3 uFocusDir;
uniform float uInnerCos; uniform float uOuterCos; uniform float uDim;`,
      )
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
{
  vec3 dF = normalize(vFocusPos);
  float fctr = 1.0;
  if (uFocusMode > 1.5) {
    float uu = fract(atan(dF.z, -dF.x) / 6.2831853);
    float vv = acos(clamp(dF.y, -1.0, 1.0)) / 3.1415926;
    fctr = mix(uDim, 1.0, texture2D(uMask, vec2(uu, vv)).r);
  } else if (uFocusMode > 0.5) {
    fctr = mix(uDim, 1.0, smoothstep(uOuterCos, uInnerCos, dot(dF, uFocusDir)));
  }
  totalEmissiveRadiance *= fctr;
}`,
      );
  }, []);

  // Drive the focus mode from the current selection.
  useEffect(() => {
    const u = uniforms.current;
    if (city) {
      const loc = cityCoord(events, city);
      if (loc) {
        u.uFocusDir.value.copy(latLngToVec3(loc[0], loc[1], 1).normalize());
        u.uInnerCos.value = Math.cos(3 * DEG);
        u.uOuterCos.value = Math.cos(9 * DEG);
        u.uFocusMode.value = 1;
        return;
      }
    }
    if (country) {
      const mask = buildCountryMask(country);
      if (mask) {
        u.uMask.value = mask;
        u.uFocusMode.value = 2;
        return;
      }
      const loc = countryCentroid(events, country); // fallback: spotlight
      if (loc) {
        u.uFocusDir.value.copy(latLngToVec3(loc[0], loc[1], 1).normalize());
        u.uInnerCos.value = Math.cos(16 * DEG);
        u.uOuterCos.value = Math.cos(34 * DEG);
        u.uFocusMode.value = 1;
        return;
      }
    }
    u.uFocusMode.value = 0;
  }, [city, country, events]);

  useFrame(({ clock }) => {
    if (matRef.current) {
      // Global brightness is just the light-up intro; spatial dimming is in the shader.
      matRef.current.emissiveIntensity = 0.25 + 2.6 * easeOut(clock.elapsedTime / 1.6);
    }
  });

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[R, 96, 96]} />
      <meshStandardMaterial
        ref={matRef}
        color="#050302"
        emissive="#ffb24d"
        emissiveMap={tex}
        emissiveIntensity={0.25}
        roughness={1}
        metalness={0}
        toneMapped={false}
        onBeforeCompile={onBeforeCompile}
      />
    </mesh>
  );
}

type MarkerDatum = { name: string; country: string | null; pos: THREE.Vector3 };

function Markers({ markers }: { markers: MarkerDatum[] }) {
  return (
    <>
      {markers.map((d) => (
        <Billboard key={d.name} position={d.pos}>
          {/* small white square marker */}
          <mesh>
            <planeGeometry args={[0.006, 0.006]} />
            <meshBasicMaterial color="#fff3d6" toneMapped={false} />
          </mesh>
          {/* city name in caps above the square */}
          <Text
            position={[0, 0.02, 0]}
            fontSize={0.013}
            color="#ffe7b0"
            anchorX="center"
            anchorY="bottom"
            letterSpacing={0.08}
            outlineWidth={0.001}
            outlineColor="#000000"
            outlineOpacity={0.85}
          >
            {d.name.toUpperCase()}
          </Text>
        </Billboard>
      ))}
    </>
  );
}

// Reusable scratch (single World instance) — avoids per-frame allocation.
const AXIS_Y = new THREE.Vector3(0, 1, 0);
const AXIS_X = new THREE.Vector3(1, 0, 0);
const MAX_PITCH = 1.3; // clamp so a drag can't roll over the poles
const DRAG_SENS = 0.005; // radians per pixel
const IDLE_RESUME_S = 3; // seconds of no interaction before the ambient spin returns
const TAP_MOVE_PX = 8; // movement under this on release = a tap (select), not a drag
const TAP_HIT_PX = 32; // screen-space radius (px) within which a tap picks a city
const FRONT_Z = 0.15; // world-z above this = near, visible hemisphere (else occluded)

// yaw/pitch (for the global qX(pitch)*qY(yaw) model) that bring a lat/lng to
// face the camera (+Z) — i.e. center that location, north-up, no roll. Used for
// the opening view and for "zoom out in place" when deselecting.
function faceYawPitch(lat: number, lng: number): { yaw: number; pitch: number } {
  const p = latLngToVec3(lat, lng, 1).normalize();
  return {
    yaw: Math.atan2(-p.x, p.z),
    pitch: Math.max(-MAX_PITCH, Math.min(MAX_PITCH, Math.atan2(p.y, Math.hypot(p.x, p.z)))),
  };
}

function World({ isMobile }: { isMobile: boolean }) {
  const events = useStore((s) => s.events);
  const country = useStore((s) => s.country);
  const city = useStore((s) => s.city);

  const groupRef = useRef<THREE.Group>(null);
  const earthRef = useRef<THREE.Mesh>(null);
  const { camera, gl } = useThree();

  // The lat/lng the current selection focuses on (city, else country centroid).
  const focusLoc = useMemo(
    () =>
      city ? cityCoord(events, city) : country ? countryCentroid(events, country) : null,
    [events, country, city],
  );

  const targetQuat = useMemo(() => {
    if (!focusLoc) return null;
    // Orientation that faces the city AND keeps north up (no roll), so the
    // region appears upright/vertical rather than rolled sideways.
    const n = latLngToVec3(focusLoc[0], focusLoc[1], 1).normalize();
    const worldUp = new THREE.Vector3(0, 1, 0);
    const north = worldUp.clone().sub(n.clone().multiplyScalar(n.dot(worldUp)));
    if (north.lengthSq() < 1e-6) north.set(0, 0, -1); // at a pole
    north.normalize();
    const east = new THREE.Vector3().crossVectors(north, n).normalize();
    // Rotation whose rows are [east, north, n] maps east→+X, north→+Y, n→+Z.
    const m = new THREE.Matrix4().set(
      east.x, east.y, east.z, 0,
      north.x, north.y, north.z, 0,
      n.x, n.y, n.z, 0,
      0, 0, 0, 1,
    );
    return new THREE.Quaternion().setFromRotationMatrix(m);
  }, [focusLoc]);

  // Remember the last focused location so that on DESELECT we pull the camera
  // straight back from that same spot (face it at global zoom), instead of
  // snapping to a different orientation.
  const focusLocRef = useRef(focusLoc);
  if (focusLoc) focusLocRef.current = focusLoc;

  // Pull the camera back a bit on a narrow portrait screen so the focused
  // region (and the whole globe) fits the width instead of being clipped.
  const zBase = city ? 1.7 : country ? 2.15 : 2.78; // global view default zoom
  const targetZ = isMobile ? zBase * 1.32 : zBase;

  // City markers for the current scope (lifted here so the tap handler below can
  // hit-test them): a city shows only itself; a country shows only its cities;
  // the globe shows them all.
  const markers = useMemo<MarkerDatum[]>(() => {
    const seen = new Map<string, MarkerDatum>();
    for (const e of events) {
      if (city) {
        if (e.city !== city) continue;
      } else if (country) {
        if (e.country !== country) continue;
      }
      if (e.city && hasCoords(e) && !seen.has(e.city)) {
        seen.set(e.city, {
          name: e.city,
          country: e.country,
          pos: latLngToVec3(e.latitude as number, e.longitude as number, R * 1.02),
        });
      }
    }
    return [...seen.values()];
  }, [events, city, country]);
  const markersRef = useRef(markers);
  markersRef.current = markers; // keep the native tap handler reading the latest

  // --- user drag-to-rotate, ONLY when global (no region/city selected) ---
  const focused = !!targetQuat;
  const focusedRef = useRef(focused);
  focusedRef.current = focused; // keep native handlers in sync with render state

  const yaw = useRef(0);
  const pitch = useRef(0);
  const velYaw = useRef(0);
  const velPitch = useRef(0);
  const dragging = useRef(false);
  const nowRef = useRef(0); // latest frame time (clock seconds)
  const lastInteract = useRef(-999);
  const wasFocused = useRef(focused);
  const qY = useRef(new THREE.Quaternion());
  const qX = useRef(new THREE.Quaternion());

  // Open with the globe ORIENTED to the Riyadh / Middle-East region (between
  // Europe and Asia) at the normal global zoom — just the starting rotation,
  // NOT a selection or zoom — then the idle spin carries on from there.
  // Solve yaw/pitch for our qX(pitch)*qY(yaw) model that brings Riyadh's
  // direction to face the camera (+Z), i.e. centers that region.
  const initedView = useRef(false);
  if (!initedView.current) {
    const init = faceYawPitch(24.7136, 46.6753); // Riyadh
    yaw.current = init.yaw;
    pitch.current = init.pitch;
    initedView.current = true;
  }

  // Pointer (mouse + touch) handlers on the canvas. Pointer-capture keeps a drag
  // alive even if it strays over the side panels; touch-action:none lets a swipe
  // rotate instead of scrolling. No-op while a region is focused.
  useEffect(() => {
    const el = gl.domElement;
    el.style.touchAction = "none";
    let downX = 0;
    let downY = 0;
    let lastX = 0;
    let lastY = 0;
    const scratch = new THREE.Vector3();

    // A tap (negligible movement) selects the nearest front-facing city marker.
    // Hit-tested in screen space against a generous radius so the tiny dots are
    // easy to tap; markers on the far hemisphere (occluded by the globe) are
    // skipped. A tap on EMPTY space while zoomed in clears back to the globe.
    const handleTap = (clientX: number, clientY: number) => {
      const g = groupRef.current;
      if (!g) return;
      const rect = el.getBoundingClientRect();
      const tx = clientX - rect.left;
      const ty = clientY - rect.top;
      const q = g.quaternion;
      let best: MarkerDatum | null = null;
      let bestDist = TAP_HIT_PX;
      for (const m of markersRef.current) {
        scratch.copy(m.pos).applyQuaternion(q); // world position (group is rotation-only at origin)
        if (scratch.z <= FRONT_Z) continue; // far side — behind the globe
        scratch.project(camera); // -> normalized device coords
        const sx = (scratch.x * 0.5 + 0.5) * rect.width;
        const sy = (-scratch.y * 0.5 + 0.5) * rect.height;
        const d = Math.hypot(sx - tx, sy - ty);
        if (d < bestDist) {
          bestDist = d;
          best = m;
        }
      }
      if (best) {
        useStore.getState().focusCity(best.country, best.name);
      } else if (focusedRef.current) {
        useStore.getState().selectCountry(null); // empty tap while zoomed in -> back to globe
      }
    };

    const onDown = (e: PointerEvent) => {
      downX = lastX = e.clientX;
      downY = lastY = e.clientY;
      // Rotation only when global; tap-to-select works in any scope (below).
      if (!focusedRef.current) {
        dragging.current = true;
        velYaw.current = 0;
        velPitch.current = 0;
        lastInteract.current = nowRef.current;
        el.setPointerCapture?.(e.pointerId);
        el.style.cursor = "grabbing";
      }
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging.current) return;
      const dYaw = (e.clientX - lastX) * DRAG_SENS;
      // Vertical inverted vs. raw cursor delta so up/down feels right.
      const dPitch = (e.clientY - lastY) * DRAG_SENS;
      lastX = e.clientX;
      lastY = e.clientY;
      yaw.current += dYaw;
      pitch.current = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch.current + dPitch));
      velYaw.current = dYaw;
      velPitch.current = dPitch;
      lastInteract.current = nowRef.current;
    };
    const endDrag = (e: PointerEvent) => {
      if (!dragging.current) return;
      dragging.current = false;
      lastInteract.current = nowRef.current;
      el.releasePointerCapture?.(e.pointerId);
      if (!focusedRef.current) el.style.cursor = "grab";
    };
    const onUp = (e: PointerEvent) => {
      endDrag(e);
      if (Math.hypot(e.clientX - downX, e.clientY - downY) < TAP_MOVE_PX) {
        handleTap(e.clientX, e.clientY); // it was a tap, not a drag
      }
    };

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", endDrag);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", endDrag);
    };
  }, [gl, camera]);

  // grab cursor only while the globe is freely rotatable
  useEffect(() => {
    gl.domElement.style.cursor = focused ? "default" : "grab";
  }, [gl, focused]);

  // Esc clears the selection back to the globe (desktop convention).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") useStore.getState().selectCountry(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useFrame((state, delta) => {
    nowRef.current = state.clock.elapsedTime;
    const g = groupRef.current;
    if (g) {
      if (targetQuat) {
        // focused: lock to the region (slerps smoothly from wherever we are)
        g.quaternion.slerp(targetQuat, 0.06);
        wasFocused.current = true;
      } else {
        // global: user-controlled free spin + ambient idle spin.
        if (wasFocused.current) {
          // just deselected — face the SAME location we were zoomed into (at
          // global zoom), so the camera simply pulls back in place instead of
          // snapping elsewhere. The focused view is already north-up centered on
          // it, so this matches and there's no jump.
          const loc = focusLocRef.current;
          if (loc) {
            const fp = faceYawPitch(loc[0], loc[1]);
            yaw.current = fp.yaw;
            pitch.current = fp.pitch;
          }
          velYaw.current = 0;
          velPitch.current = 0;
          wasFocused.current = false;
        }
        if (!dragging.current) {
          // coast on release (inertia), then decay
          yaw.current += velYaw.current;
          pitch.current = Math.max(
            -MAX_PITCH,
            Math.min(MAX_PITCH, pitch.current + velPitch.current),
          );
          velYaw.current *= 0.92;
          velPitch.current *= 0.92;
          // resume the slow ambient spin after a spell of no interaction
          if (state.clock.elapsedTime - lastInteract.current > IDLE_RESUME_S) {
            yaw.current += delta * 0.05;
          }
        }
        // Pitch about world X applied LAST so the vertical-drag axis is always
        // screen-horizontal — the tilt stays consistent no matter how far we've
        // yawed (yaw applied first, about the globe's own vertical axis).
        g.quaternion
          .copy(qX.current.setFromAxisAngle(AXIS_X, pitch.current))
          .multiply(qY.current.setFromAxisAngle(AXIS_Y, yaw.current));
      }
    }
    camera.position.z += (targetZ - camera.position.z) * 0.06;
    camera.lookAt(0, 0, 0);

    // Shift the whole render ~16% left on desktop so the globe uses the open
    // space beside the right-hand panels. A screen-space view offset (not a 3D
    // move) keeps the shift CONSTANT at every zoom — a focused city stays
    // left-framed too, instead of the close-up throwing it off to one side.
    // Centered on mobile.
    const cam = camera as THREE.PerspectiveCamera;
    if (isMobile) {
      if (cam.view?.enabled) cam.clearViewOffset();
    } else {
      const { width, height } = state.size;
      cam.setViewOffset(width, height, width * 0.16, 0, width, height);
    }
  });

  return (
    <group ref={groupRef}>
      <Earth meshRef={earthRef} isMobile={isMobile} />
      <Markers markers={markers} />
    </group>
  );
}

export default function Globe() {
  const isMobile = useIsMobile();
  return (
    <div className="absolute inset-0 z-0">
      <Canvas
        // Portrait phones start further back (wider fov) so the globe fits the
        // narrow width; dpr is capped lower to keep fill-rate manageable.
        camera={{ position: [0, 0, isMobile ? 3.67 : 2.78], fov: isMobile ? 42 : 38 }}
        gl={{ antialias: true }}
        dpr={[1, 2]}
      >
        <color attach="background" args={["#040308"]} />
        <ambientLight intensity={0.15} />
        <Suspense fallback={null}>
          <Stars
            radius={60}
            depth={25}
            count={isMobile ? 1100 : 2600}
            factor={3.5}
            fade
            speed={0.4}
          />
          <World isMobile={isMobile} />
          <EffectComposer>
            <Bloom
              intensity={isMobile ? 1.0 : 1.5}
              luminanceThreshold={0.55}
              luminanceSmoothing={0.25}
              mipmapBlur
              radius={isMobile ? 0.5 : 0.75}
            />
          </EffectComposer>
        </Suspense>
      </Canvas>
    </div>
  );
}
