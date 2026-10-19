import { useEffect, useRef } from "react";
import {
  AmbientLight,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  FrontSide,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  Vector3,
  WebGLRenderer,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { applyPoint, edgeKey, edgeMap, type Motion } from "@origami/engine";

const EDGE_DARK: [number, number, number] = [0.1, 0.1, 0.1];
const EDGE_CREASE: [number, number, number] = [0.6, 0.6, 0.6];

export interface Fold3DProps {
  motion: Motion;
  t: number;
  colorUp: string;
  colorDown: string;
  /** Changes when the camera should go back to the default view. */
  resetKey: number;
}

interface Parts {
  renderer: WebGLRenderer;
  camera: PerspectiveCamera;
  controls: OrbitControls;
  geometry: BufferGeometry;
  lines: LineSegments;
  front: MeshStandardMaterial;
  back: MeshStandardMaterial;
}

/**
 * 3D view of one motion at time t. The engine gives per-face transforms (CP → model, with layer
 * offsets) and the view rotation; this component only triangulates, places and draws.
 */
export function Fold3D({ motion, t, colorUp, colorDown, resetKey }: Fold3DProps) {
  const host = useRef<HTMLDivElement>(null);
  const parts = useRef<Parts | null>(null);

  useEffect(() => {
    const el = host.current!;
    const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setClearColor(new Color("#ffffff"));
    el.appendChild(renderer.domElement);
    const scene = new Scene();
    const camera = new PerspectiveCamera(35, 1, 0.01, 100);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    scene.add(new AmbientLight(0xffffff, 1.5));
    const key = new DirectionalLight(0xffffff, 1.4);
    key.position.set(1, 2, 3);
    scene.add(key);
    const fill = new DirectionalLight(0xffffff, 0.7);
    fill.position.set(-1, -1, -3);
    scene.add(fill);
    const geometry = new BufferGeometry();
    // Faces are pushed back so edges drawn on them always win the depth test.
    const mat = (side: typeof FrontSide | typeof BackSide) =>
      new MeshStandardMaterial({ side, flatShading: true, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
    const front = mat(FrontSide);
    const back = mat(BackSide);
    scene.add(new Mesh(geometry, front), new Mesh(geometry, back));
    const lines = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ vertexColors: true }));
    scene.add(lines);
    const resize = () => {
      renderer.setSize(el.clientWidth, el.clientHeight);
      camera.aspect = el.clientWidth / Math.max(el.clientHeight, 1);
      camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    resize();
    renderer.setAnimationLoop(() => {
      controls.update();
      renderer.render(scene, camera);
    });
    parts.current = { renderer, camera, controls, geometry, lines, front, back };
    // Hook for automated checks (camera angles for screenshots).
    (el as HTMLDivElement & { __three?: unknown }).__three = { camera, controls, renderer, scene };
    return () => {
      ro.disconnect();
      renderer.setAnimationLoop(null);
      renderer.dispose();
      el.removeChild(renderer.domElement);
      parts.current = null;
    };
  }, []);

  useEffect(() => {
    const p = parts.current;
    if (!p) return;
    p.camera.position.set(0, -0.75, 1.6);
    p.controls.target.set(0, 0, 0);
    p.controls.update();
  }, [resetKey]);

  useEffect(() => {
    const p = parts.current;
    if (!p) return;
    p.front.color.set(colorUp);
    p.back.color.set(colorDown);
  }, [colorUp, colorDown]);

  useEffect(() => {
    const p = parts.current;
    if (!p) return;
    const s = motion.state;
    const fr = motion.frame(t);
    const em = edgeMap(s.cp);
    const faces = fr.faces.map((pts) => pts.map((q) => applyPoint(fr.view, q)));
    // Keep the model centred: subtract the centre of its bounding box.
    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const face of faces) for (const q of face) min.min(new Vector3(...q)), max.max(new Vector3(...q));
    const c = min.add(max).multiplyScalar(0.5);
    const pos: number[] = [];
    const linePos: number[] = [];
    const lineCol: number[] = [];
    faces.forEach((pts, f) => {
      const w = pts.map((q) => [q[0] - c.x, q[1] - c.y, q[2] - c.z]);
      for (let k = 1; k + 1 < w.length; k++) pos.push(...w[0], ...w[k], ...w[k + 1]); // faces are convex
      const loop = s.cp.faces[f];
      w.forEach((q, k) => {
        const r = w[(k + 1) % w.length];
        const e = em.get(edgeKey(loop[k], loop[(k + 1) % loop.length]));
        const a = e === undefined ? "B" : s.cp.edges[e].a;
        const col = a === "F" || a === "U" ? EDGE_CREASE : EDGE_DARK;
        linePos.push(...q, ...r);
        lineCol.push(...col, ...col);
      });
    });
    p.geometry.setAttribute("position", new BufferAttribute(new Float32Array(pos), 3));
    p.geometry.computeVertexNormals();
    p.geometry.computeBoundingSphere();
    p.lines.geometry.setAttribute("position", new BufferAttribute(new Float32Array(linePos), 3));
    p.lines.geometry.setAttribute("color", new BufferAttribute(new Float32Array(lineCol), 3));
    p.lines.geometry.computeBoundingSphere();
  }, [motion, t]);

  return <div className="view3d" ref={host} data-testid="fold3d" />;
}
