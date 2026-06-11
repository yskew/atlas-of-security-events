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
  // Phones load a 2K texture (~70KB) instead of the 8K (~3MB) — far less to
  // download and far less GPU memory, while staying crisp on a small screen.
  const tex = useLoader(
    THREE.TextureLoader,
    isMobile ? "/textures/earth-night-2k.jpg" : "/textures/earth-night-8k.jpg",
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

function Markers() {
  const events = useStore((s) => s.events);
  const city = useStore((s) => s.city);
  const country = useStore((s) => s.country);
  const data = useMemo(() => {
    const seen = new Map<string, THREE.Vector3>();
    for (const e of events) {
      // Focus narrows what's lit: a city shows only itself; a country shows
      // only its own cities; the globe shows them all.
      if (city) {
        if (e.city !== city) continue;
      } else if (country) {
        if (e.country !== country) continue;
      }
      if (e.city && hasCoords(e) && !seen.has(e.city)) {
        seen.set(e.city, latLngToVec3(e.latitude as number, e.longitude as number, R * 1.02));
      }
    }
    return [...seen.entries()].map(([name, pos]) => ({ name, pos }));
  }, [events, city, country]);

  return (
    <>
      {data.map((d) => (
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

function World({ isMobile }: { isMobile: boolean }) {
  const events = useStore((s) => s.events);
  const country = useStore((s) => s.country);
  const city = useStore((s) => s.city);

  const groupRef = useRef<THREE.Group>(null);
  const earthRef = useRef<THREE.Mesh>(null);
  const { camera, gl } = useThree();

  const targetQuat = useMemo(() => {
    const loc = city
      ? cityCoord(events, city)
      : country
        ? countryCentroid(events, country)
        : null;
    if (!loc) return null;
    // Orientation that faces the city AND keeps north up (no roll), so the
    // region appears upright/vertical rather than rolled sideways.
    const n = latLngToVec3(loc[0], loc[1], 1).normalize();
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
  }, [events, country, city]);

  // Pull the camera back a bit on a narrow portrait screen so the focused
  // region (and the whole globe) fits the width instead of being clipped.
  const zBase = city ? 1.7 : country ? 2.15 : 2.85;
  const targetZ = isMobile ? zBase * 1.32 : zBase;

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

  // Pointer (mouse + touch) handlers on the canvas. Pointer-capture keeps a drag
  // alive even if it strays over the side panels; touch-action:none lets a swipe
  // rotate instead of scrolling. No-op while a region is focused.
  useEffect(() => {
    const el = gl.domElement;
    el.style.touchAction = "none";
    let lastX = 0;
    let lastY = 0;

    const onDown = (e: PointerEvent) => {
      if (focusedRef.current) return;
      dragging.current = true;
      lastX = e.clientX;
      lastY = e.clientY;
      velYaw.current = 0;
      velPitch.current = 0;
      lastInteract.current = nowRef.current;
      el.setPointerCapture?.(e.pointerId);
      el.style.cursor = "grabbing";
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
    const onUp = (e: PointerEvent) => {
      dragging.current = false;
      lastInteract.current = nowRef.current;
      el.releasePointerCapture?.(e.pointerId);
      if (!focusedRef.current) el.style.cursor = "grab";
    };

    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    };
  }, [gl]);

  // grab cursor only while the globe is freely rotatable
  useEffect(() => {
    gl.domElement.style.cursor = focused ? "default" : "grab";
  }, [gl, focused]);

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
          // just returned from a focus — seed yaw/pitch from the current
          // orientation so control resumes without a visible jump.
          g.rotation.reorder("XYZ"); // matches the qX * qY compose order below
          yaw.current = g.rotation.y;
          pitch.current = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, g.rotation.x));
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
  });

  return (
    <group ref={groupRef}>
      <Earth meshRef={earthRef} isMobile={isMobile} />
      <Markers />
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
        camera={{ position: [0, 0, isMobile ? 3.7 : 2.85], fov: isMobile ? 42 : 38 }}
        gl={{ antialias: true }}
        dpr={isMobile ? [1, 1.5] : [1, 2]}
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
