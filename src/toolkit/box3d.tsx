'use client';
import { useEffect, useRef, useState } from 'react';
import type * as Three from 'three';
import type { BoxPart } from './box';
import { tx, type Language } from './copy';

type Size = { width: number; depth: number; height: number };
type Stage = { THREE: typeof Three; renderer: Three.WebGLRenderer; scene: Three.Scene; camera: Three.PerspectiveCamera; group: Three.Group; draw: () => void };

/**
 * Assembled 3D preview. Each part's 2D outline (with holes) is extruded by the
 * material thickness and placed back on its slab, so what you see is exactly
 * what is exported. Drag to orbit, scroll to zoom.
 */
export default function Box3D({ parts, outside, thickness, lang }: { parts: BoxPart[]; outside: Size; thickness: number; lang: Language }) {
  const host = useRef<HTMLDivElement>(null), stage = useRef<Stage | null>(null), view = useRef({ yaw: -0.65, pitch: 0.5, zoom: 1 });
  const [explode, setExplode] = useState(0), [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let disposed = false, observer: ResizeObserver | undefined;
    import('three').then(THREE => {
      const element = host.current;
      if (disposed || !element) return;
      let renderer: Three.WebGLRenderer;
      try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); } catch { setState('error'); return; }
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      renderer.domElement.dataset.testid = 'box-3d-canvas';
      renderer.domElement.style.touchAction = 'none';
      element.appendChild(renderer.domElement);
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(35, 1, 1, 100000), group = new THREE.Group();
      scene.add(group, new THREE.HemisphereLight(0xfff8ee, 0x5d5446, 1.6));
      const sun = new THREE.DirectionalLight(0xffffff, 1.8); sun.position.set(1, 2, 1.5); scene.add(sun);
      const draw = () => {
        const radius = Math.max(1, ...group.children.map(child => new THREE.Box3().setFromObject(child).getBoundingSphere(new THREE.Sphere()).radius + child.position.length()));
        const { yaw, pitch, zoom } = view.current, distance = radius * 3.2 / zoom;
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

  useEffect(() => {
    const current = stage.current;
    if (!current || state !== 'ready') return;
    const { THREE, group } = current;
    clear(group);
    const largest = Math.max(outside.width, outside.depth, outside.height), centre = [outside.width / 2, outside.depth / 2, outside.height / 2];
    parts.forEach((part, index) => {
      const outline = part.shape.contours.filter(c => c.closed && c.layer !== 'engrave');
      if (!outline.length) return;
      const shape = new THREE.Shape(outline[0].points.map(p => new THREE.Vector2(p.x, p.y)));
      shape.holes = outline.slice(1).map(c => new THREE.Path(c.points.map(p => new THREE.Vector2(p.x, p.y))));
      const s = part.slab, depth = s.max[s.normal] - s.min[s.normal];
      const geometry = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1 });
      // Drawing (x, y, depth) → box (u, v, normal) → three.js (x, z up, -y towards the viewer).
      const box = new THREE.Matrix4(), toThree = new THREE.Matrix4();
      const column = (axis: number, sign: number) => { const v = [0, 0, 0]; v[axis] = sign; return v; };
      const cu = column(s.u, 1), cv = column(s.v, s.flipV ? -1 : 1), cn = column(s.normal, 1), origin = [0, 0, 0];
      origin[s.u] = s.min[s.u]; origin[s.v] = s.flipV ? s.max[s.v] : s.min[s.v]; origin[s.normal] = s.min[s.normal];
      box.set(cu[0], cv[0], cn[0], origin[0], cu[1], cv[1], cn[1], origin[1], cu[2], cv[2], cn[2], origin[2], 0, 0, 0, 1);
      toThree.set(1, 0, 0, -centre[0], 0, 0, 1, -centre[2], 0, -1, 0, centre[1], 0, 0, 0, 1);
      const shade = 0.9 + 0.1 * ((index * 37) % 7) / 6;
      const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: new THREE.Color(0.86 * shade, 0.71 * shade, 0.52 * shade), roughness: 0.85, side: THREE.DoubleSide }));
      mesh.applyMatrix4(new THREE.Matrix4().multiplyMatrices(toThree, box));
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 25), new THREE.LineBasicMaterial({ color: 0x4a3a28, transparent: true, opacity: 0.55 }));
      edges.applyMatrix4(mesh.matrix);
      const holder = new THREE.Group(); holder.add(mesh, edges);
      // Explode: push each part out along its normal; drawer parts also slide forward.
      const direction = [0, 0, 0], slabCentre = (s.min[s.normal] + s.max[s.normal]) / 2;
      direction[s.normal] = Math.abs(slabCentre - centre[s.normal]) < 1e-6 ? (s.normal === 2 ? 1 : 0) : Math.sign(slabCentre - centre[s.normal]);
      const push = explode * largest * 0.35, slide = part.name.startsWith('Drawer') ? explode * outside.depth * 0.8 : 0;
      holder.position.set(direction[0] * push, direction[2] * push, -(direction[1] * push) + slide);
      group.add(holder);
    });
    current.draw();
  }, [parts, outside, thickness, explode, state]);

  return <div className="box-3d">
    <div ref={host} className="box-3d-stage" style={{ height: 420, position: 'relative', cursor: 'grab' }} aria-label={tx(lang, '3D preview of the assembled box. Drag to rotate, scroll to zoom.', 'معاينة ثلاثية الأبعاد للصندوق المجمّع. اسحب للتدوير ومرّر للتكبير.')} role="img">
      {state !== 'ready' && <p className="micro" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>{state === 'loading' ? tx(lang, 'Loading 3D preview…', 'جارٍ تحميل المعاينة ثلاثية الأبعاد…') : tx(lang, '3D preview needs WebGL, which this browser has turned off.', 'تحتاج المعاينة ثلاثية الأبعاد إلى WebGL وهو غير مفعّل في هذا المتصفح.')}</p>}
    </div>
    <div className="box-3d-controls">
      <label className="range"><span>{tx(lang, 'Explode view', 'تفكيك العرض')}<b dir="ltr">{Math.round(explode * 100)}%</b></span><input type="range" min={0} max={1} step={0.05} value={explode} onChange={e => setExplode(Number(e.target.value))} aria-label={tx(lang, 'Explode view', 'تفكيك العرض')}/></label>
      <button className="text-button" onClick={() => { view.current = { yaw: -0.65, pitch: 0.5, zoom: 1 }; stage.current?.draw(); }}>{tx(lang, 'Reset view', 'إعادة ضبط العرض')}</button>
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
