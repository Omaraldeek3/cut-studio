'use client';
import { useEffect, useRef, useState } from 'react';
import type * as Three from 'three';
import type { Point } from './types';
import { tx, type Language } from './copy';

/** One flat part to extrude: its outline and holes in drawing millimetres,
 *  the point it turns about, and how fast it turns relative to the first. */
export type SpinPart = { outline: Point[]; holes: Point[][]; centre: Point; ratio: number };
type Stage = { THREE: typeof Three; renderer: Three.WebGLRenderer; scene: Three.Scene; camera: Three.PerspectiveCamera; group: Three.Group; draw: () => void };

/**
 * Gears in 3D. Each outline is extruded by the material thickness exactly as
 * it is exported, and meshing gears turn together at their tooth ratio, so a
 * pair that jams or skips shows it here before it is cut. Drag to orbit,
 * scroll to zoom.
 */
export default function Gear3D({ parts, thickness, lang }: { parts: SpinPart[]; thickness: number; lang: Language }) {
  const host = useRef<HTMLDivElement>(null), stage = useRef<Stage | null>(null), view = useRef({ yaw: 0.35, pitch: 0.75, zoom: 1 });
  const [spin, setSpin] = useState(true), [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const angle = useRef(0);

  useEffect(() => {
    let disposed = false, observer: ResizeObserver | undefined;
    import('three').then(THREE => {
      const element = host.current;
      if (disposed || !element) return;
      let renderer: Three.WebGLRenderer;
      try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); } catch { setState('error'); return; }
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      renderer.domElement.dataset.testid = 'gear-3d-canvas';
      renderer.domElement.style.touchAction = 'none';
      element.appendChild(renderer.domElement);
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(35, 1, 1, 100000), group = new THREE.Group();
      scene.add(group, new THREE.HemisphereLight(0xfff8ee, 0x5d5446, 1.6));
      const sun = new THREE.DirectionalLight(0xffffff, 1.8); sun.position.set(1, 2, 1.5); scene.add(sun);
      const draw = () => {
        const box = new THREE.Box3().setFromObject(group), radius = Math.max(1, box.getBoundingSphere(new THREE.Sphere()).radius);
        const { yaw, pitch, zoom } = view.current, distance = radius * 3 / zoom;
        camera.position.set(Math.sin(yaw) * Math.cos(pitch) * distance, Math.sin(pitch) * distance, Math.cos(yaw) * Math.cos(pitch) * distance);
        camera.near = distance / 100; camera.far = distance * 10; camera.updateProjectionMatrix();
        camera.lookAt(0, 0, 0);
        renderer.render(scene, camera);
      };
      const resize = () => { const w = element.clientWidth, h = element.clientHeight; renderer.setSize(w, h); camera.aspect = w / Math.max(1, h); draw(); };
      observer = new ResizeObserver(resize); observer.observe(element);
      stage.current = { THREE, renderer, scene, camera, group, draw };
      let drag: { x: number; y: number } | null = null;
      renderer.domElement.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY }; renderer.domElement.setPointerCapture(e.pointerId); });
      renderer.domElement.addEventListener('pointermove', e => {
        if (!drag) return;
        view.current.yaw -= (e.clientX - drag.x) * 0.01;
        view.current.pitch = Math.max(-1.45, Math.min(1.45, view.current.pitch + (e.clientY - drag.y) * 0.01));
        drag = { x: e.clientX, y: e.clientY }; draw();
      });
      renderer.domElement.addEventListener('pointerup', () => { drag = null; });
      renderer.domElement.addEventListener('wheel', e => { e.preventDefault(); view.current.zoom = Math.max(0.3, Math.min(6, view.current.zoom * Math.exp(-e.deltaY * 0.001))); draw(); }, { passive: false });
      setState('ready');
      resize();
    }).catch(() => setState('error'));
    return () => {
      disposed = true; observer?.disconnect();
      const current = stage.current;
      if (current) { clear(current.group); current.renderer.dispose(); current.renderer.domElement.remove(); }
      stage.current = null;
    };
  }, []);

  // Rebuild the meshes when the parts change; each sits in a pivot at its centre.
  useEffect(() => {
    const current = stage.current;
    if (!current || state !== 'ready') return;
    const { THREE, group } = current;
    clear(group);
    if (!parts.length) { current.draw(); return; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of parts) for (const q of p.outline) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
    const mid = { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
    parts.forEach((part, index) => {
      const local = (q: Point) => new THREE.Vector2(q.x - part.centre.x, -(q.y - part.centre.y));
      const shape = new THREE.Shape(part.outline.map(local));
      shape.holes = part.holes.map(h => new THREE.Path(h.map(local)));
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: false, curveSegments: 1 });
      geometry.translate(0, 0, -thickness / 2);
      const tone = index ? [0.62, 0.7, 0.62] : [0.86, 0.71, 0.52];
      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: new THREE.Color(...tone), roughness: 0.8, side: THREE.DoubleSide }));
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 25), new THREE.LineBasicMaterial({ color: 0x4a3a28, transparent: true, opacity: 0.5 }));
      // Lie flat: drawing x → three x, drawing y → three -z.
      const pivot = new THREE.Group();
      pivot.add(mesh, edges);
      pivot.rotation.x = -Math.PI / 2;
      pivot.position.set(part.centre.x - mid.x, 0, part.centre.y - mid.y);
      pivot.userData.ratio = part.ratio;
      group.add(pivot);
    });
    current.draw();
  }, [parts, thickness, state]);

  // Turn the gears together; the second turns the other way at the tooth ratio.
  useEffect(() => {
    if (!spin || state !== 'ready') return;
    let frame = 0, last = performance.now();
    const tick = (now: number) => {
      const current = stage.current;
      if (!current) return;
      angle.current += ((now - last) / 1000) * 0.6;
      last = now;
      for (const pivot of current.group.children) pivot.rotation.z = angle.current * (pivot.userData.ratio as number);
      current.draw();
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [spin, state]);

  return <div className="box-3d">
    <div ref={host} className="box-3d-stage" style={{ height: 420, position: 'relative', cursor: 'grab' }} aria-label={tx(lang, '3D preview of the gears. Drag to rotate, scroll to zoom.', 'معاينة ثلاثية الأبعاد للتروس. اسحب للتدوير ومرّر للتكبير.')} role="img">
      {state !== 'ready' && <p className="micro" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>{state === 'loading' ? tx(lang, 'Loading 3D preview…', 'جارٍ تحميل المعاينة ثلاثية الأبعاد…') : tx(lang, '3D preview needs WebGL, which this browser has turned off.', 'تحتاج المعاينة ثلاثية الأبعاد إلى WebGL وهو غير مفعّل في هذا المتصفح.')}</p>}
    </div>
    <div className="box-3d-controls">
      <button className="text-button" onClick={() => setSpin(v => !v)}>{spin ? tx(lang, 'Stop turning', 'أوقف الدوران') : tx(lang, 'Turn the gears', 'أدر التروس')}</button>
      <button className="text-button" onClick={() => { view.current = { yaw: 0.35, pitch: 0.75, zoom: 1 }; stage.current?.draw(); }}>{tx(lang, 'Reset view', 'إعادة ضبط العرض')}</button>
    </div>
  </div>;
}

function clear(group: Three.Group) {
  for (const holder of [...group.children]) {
    holder.traverse(object => {
      const item = object as Three.Mesh;
      item.geometry?.dispose();
      const material = item.material as Three.Material | Three.Material[] | undefined;
      if (Array.isArray(material)) material.forEach(m => m.dispose()); else material?.dispose();
    });
    group.remove(holder);
  }
}
