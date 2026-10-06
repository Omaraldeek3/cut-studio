'use client';
import { useEffect, useRef, useState } from 'react';
import type * as Three from 'three';
import type { Contour } from './types';
import type { Piece } from './assembly';
import { tx, type Language } from './copy';

type Stage = { THREE: typeof Three; renderer: Three.WebGLRenderer; scene: Three.Scene; camera: Three.PerspectiveCamera; group: Three.Group; draw: () => void };

const area = (c: Contour) => { let a = 0; for (let i = 0, j = c.points.length - 1; i < c.points.length; j = i++) a += (c.points[j].x + c.points[i].x) * (c.points[j].y - c.points[i].y); return Math.abs(a / 2); };

/**
 * The finished product in 3D. Each piece's outline (with its slots and holes)
 * is extruded by its thickness and placed where it goes; engraving and open
 * cuts are drawn on its face. Drag to orbit, scroll to zoom, and pull the
 * parts apart to see how they join.
 */
export default function Assembly3D({ pieces, lang, label }: { pieces: Piece[]; lang: Language; label: string }) {
  const host = useRef<HTMLDivElement>(null), stage = useRef<Stage | null>(null), view = useRef({ yaw: -0.6, pitch: 0.45, zoom: 1 });
  const [explode, setExplode] = useState(0), [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    let disposed = false, observer: ResizeObserver | undefined;
    import('three').then(THREE => {
      const element = host.current;
      if (disposed || !element) return;
      let renderer: Three.WebGLRenderer;
      try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); } catch { setState('error'); return; }
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      renderer.domElement.dataset.testid = 'assembly-3d-canvas';
      renderer.domElement.style.touchAction = 'none';
      element.appendChild(renderer.domElement);
      const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(35, 1, 1, 100000), group = new THREE.Group();
      scene.add(group, new THREE.HemisphereLight(0xfff8ee, 0x5d5446, 1.6));
      const sun = new THREE.DirectionalLight(0xffffff, 1.8); sun.position.set(1, 2, 1.5); scene.add(sun);
      const draw = () => {
        const sphere = new THREE.Box3().setFromObject(group).getBoundingSphere(new THREE.Sphere());
        const radius = Math.max(1, sphere.radius), { yaw, pitch, zoom } = view.current, distance = radius * 3.2 / zoom;
        camera.position.set(Math.sin(yaw) * Math.cos(pitch) * distance, Math.sin(pitch) * distance, Math.cos(yaw) * Math.cos(pitch) * distance).add(sphere.center);
        camera.near = distance / 100; camera.far = distance * 10; camera.updateProjectionMatrix();
        camera.lookAt(sphere.center);
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
    const holders = pieces.map((piece, index) => {
      const closed = piece.shape.contours.filter(c => c.closed && c.layer !== 'engrave' && c.points.length > 2);
      const holder = new THREE.Group();
      if (!closed.length) return holder;
      const outer = closed.reduce((a, b) => (area(b) > area(a) ? b : a));
      const shape = new THREE.Shape(outer.points.map(p => new THREE.Vector2(p.x, p.y)));
      shape.holes = closed.filter(c => c !== outer).map(c => new THREE.Path(c.points.map(p => new THREE.Vector2(p.x, p.y))));
      const geometry = new THREE.ExtrudeGeometry(shape, { depth: piece.depth, bevelEnabled: false, curveSegments: 1 });
      const { origin: o, u, v, n } = piece;
      const frame = new THREE.Matrix4().set(u[0], v[0], n[0], o[0], u[1], v[1], n[1], o[1], u[2], v[2], n[2], o[2], 0, 0, 0, 1);
      const shade = 0.9 + 0.1 * ((index * 37) % 7) / 6;
      const material = piece.material === 'acrylic'
        ? new THREE.MeshStandardMaterial({ color: 0xcfe6f2, roughness: 0.15, transparent: true, opacity: 0.55, side: THREE.DoubleSide })
        : new THREE.MeshStandardMaterial({ color: new THREE.Color(0.86 * shade, 0.71 * shade, 0.52 * shade), roughness: 0.85, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(geometry, material);
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 25), new THREE.LineBasicMaterial({ color: 0x4a3a28, transparent: true, opacity: 0.5 }));
      holder.add(mesh, edges);
      // Engraving and open cuts (puzzle lines, hinge slits) drawn on the front face.
      const marks = piece.shape.contours.filter(c => c.layer === 'engrave' || !c.closed);
      if (marks.length) {
        const points: number[] = [], lift = piece.depth + Math.max(0.05, piece.depth * 0.01);
        for (const c of marks) {
          const ps = c.closed ? [...c.points, c.points[0]] : c.points;
          for (let i = 1; i < ps.length; i++) points.push(ps[i - 1].x, ps[i - 1].y, lift, ps[i].x, ps[i].y, lift);
        }
        const lines = new THREE.BufferGeometry(); lines.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
        holder.add(new THREE.LineSegments(lines, new THREE.LineBasicMaterial({ color: 0x3b2a1a })));
      }
      holder.children.forEach(child => child.applyMatrix4(frame));
      return holder;
    });
    // Centre the product, then push each piece away from the middle to explode it.
    const all = new THREE.Box3(); holders.forEach(h => all.expandByObject(h));
    const middle = all.isEmpty() ? new THREE.Vector3() : all.getCenter(new THREE.Vector3()), largest = all.isEmpty() ? 1 : Math.max(...all.getSize(new THREE.Vector3()).toArray());
    holders.forEach(holder => {
      const own = new THREE.Box3().setFromObject(holder);
      const away = own.isEmpty() ? new THREE.Vector3() : own.getCenter(new THREE.Vector3()).sub(middle);
      if (away.lengthSq() < 1e-6) away.set(0, 1, 0);
      holder.position.copy(middle.clone().negate()).add(away.normalize().multiplyScalar(explode * largest * 0.35));
      group.add(holder);
    });
    current.draw();
  }, [pieces, explode, state]);

  return <div className="box-3d">
    <div ref={host} className="box-3d-stage" style={{ height: 420, position: 'relative', cursor: 'grab' }} aria-label={tx(lang, `3D preview: ${label}. Drag to rotate, scroll to zoom.`, `معاينة ثلاثية الأبعاد: ${label}. اسحب للتدوير ومرّر للتكبير.`)} role="img">
      {state !== 'ready' && <p className="micro" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>{state === 'loading' ? tx(lang, 'Loading 3D preview…', 'جارٍ تحميل المعاينة ثلاثية الأبعاد…') : tx(lang, '3D preview needs WebGL, which this browser has turned off.', 'تحتاج المعاينة ثلاثية الأبعاد إلى WebGL وهو غير مفعّل في هذا المتصفح.')}</p>}
    </div>
    <div className="box-3d-controls">
      <label className="range"><span>{tx(lang, 'Explode view', 'تفكيك العرض')}<b dir="ltr">{Math.round(explode * 100)}%</b></span><input type="range" min={0} max={1} step={0.05} value={explode} onChange={e => setExplode(Number(e.target.value))} aria-label={tx(lang, 'Explode view', 'تفكيك العرض')}/></label>
      <button className="text-button" onClick={() => { view.current = { yaw: -0.6, pitch: 0.45, zoom: 1 }; stage.current?.draw(); }}>{tx(lang, 'Reset view', 'إعادة ضبط العرض')}</button>
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
