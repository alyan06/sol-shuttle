import { MercatorCoordinate, type CustomLayerInterface, type Map as MapLibre } from 'maplibre-gl';
import {
  BoxGeometry,
  Camera,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Group,
  HemisphereLight,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  RingGeometry,
  Scene,
  Vector3,
  WebGLRenderer,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

/**
 * The shuttle as a small 3D model drawn over the map: a cutaway bus with a blue body,
 * an orange band and roof, dark glass. Built from boxes here rather than loaded from a file, so
 * there's nothing to download and its colours follow the app's theme.
 *
 * Model space is metres: X across, Y up, Z along, nose towards -Z (north when the bearing is 0).
 */

export type BusPose = {
  lng: number;
  lat: number;
  /** Compass bearing the nose points at. */
  bearing: number;
  live: boolean;
  moving: boolean;
};

export type BusColours = { blue: string; orange: string; glass: string; trim: string; halo: string };

const LENGTH_M = 7.7;
/** At street level the bus is drawn this much bigger than life, so it reads against the buildings. */
const EXAGGERATE = 2.2;
/** Zoomed out it would vanish, so it never gets shorter than this on screen. */
const MIN_LENGTH_PX = 50;
const EARTH_M = 40_075_016.686;
const PULSE_MS = 2400;

function metresPerPixel(lat: number, zoom: number): number {
  return (EARTH_M * Math.cos((lat * Math.PI) / 180)) / (512 * 2 ** zoom);
}

function softShadow(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(64, 64, 8, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(0,0,0,0.42)');
  gradient.addColorStop(0.6, 'rgba(0,0,0,0.2)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  return new CanvasTexture(canvas);
}

function buildBus(colours: BusColours) {
  const bus = new Group();
  const paints: { material: MeshLambertMaterial; base: Color }[] = [];
  const paint = (colour: string) => {
    const material = new MeshLambertMaterial({ color: colour });
    paints.push({ material, base: material.color.clone() });
    return material;
  };
  const blue = paint(colours.blue);
  const orange = paint(colours.orange);
  const glass = paint(colours.glass);
  const trim = paint(colours.trim);
  const dark = paint('#1d2230');
  const lamp = paint('#fff3c4');
  const tail = paint('#d8342b');

  const add = (mesh: Mesh, x: number, y: number, z: number) => {
    mesh.position.set(x, y, z);
    bus.add(mesh);
    return mesh;
  };
  const box = (w: number, h: number, l: number, material: MeshLambertMaterial, x: number, y: number, z: number) => add(new Mesh(new BoxGeometry(w, h, l), material), x, y, z);
  const soft = (w: number, h: number, l: number, radius: number, material: MeshLambertMaterial, x: number, y: number, z: number) =>
    add(new Mesh(new RoundedBoxGeometry(w, h, l, 3, radius), material), x, y, z);

  // Running gear.
  box(2.2, 0.3, 7.2, dark, 0, 0.5, 0);
  // One long body: blue, with the orange band below the windows and an orange roof.
  soft(2.4, 2.45, 6.2, 0.3, blue, 0, 1.78, 0.7);
  box(2.44, 0.42, 6.1, orange, 0, 1.12, 0.7);
  soft(2.16, 0.16, 5.8, 0.07, orange, 0, 3.03, 0.75);
  soft(1.3, 0.3, 1.7, 0.1, trim, 0, 3.2, 1.9);
  // Glass down both sides, cut into windows by the body's own pillars.
  box(2.45, 0.8, 5.4, glass, 0, 2.1, 0.9);
  for (const z of [-0.95, 0.05, 1.05, 2.05, 3.05]) box(2.47, 0.84, 0.13, blue, 0, 2.1, z);
  box(1.7, 0.74, 0.06, glass, 0, 2.1, 3.81);
  // The nose pushes out below a raked windscreen.
  soft(2.3, 1.0, 1.7, 0.26, blue, 0, 1.05, -3.0);
  box(2.32, 0.16, 1.7, orange, 0, 0.78, -3.0);
  const screen = box(2.08, 1.42, 0.08, glass, 0, 2.12, -2.66);
  screen.rotation.x = -0.4;
  // Bumpers and lights.
  box(2.3, 0.24, 0.16, dark, 0, 0.62, -3.86);
  box(2.3, 0.24, 0.16, dark, 0, 0.62, 3.84);
  for (const side of [-1, 1]) {
    box(0.42, 0.2, 0.06, lamp, side * 0.78, 1.18, -3.86);
    box(0.3, 0.42, 0.06, tail, side * 0.92, 1.25, 3.82);
  }
  // Wheels: one axle at the cab, a doubled one under the box.
  const tyre = new CylinderGeometry(0.46, 0.46, 0.34, 20);
  const hub = new CylinderGeometry(0.2, 0.2, 0.36, 12);
  for (const [z, width] of [
    [-2.55, 1.04],
    [2.3, 1.02],
  ]) {
    for (const side of [-1, 1]) {
      const wheel = add(new Mesh(tyre, dark), side * width, 0.46, z);
      wheel.rotation.z = Math.PI / 2;
      const cap = add(new Mesh(hub, trim), side * width, 0.46, z);
      cap.rotation.z = Math.PI / 2;
    }
  }

  // What isn't the bus: a soft shadow under it, and a ring that breathes while it's moving.
  const shadow = new Mesh(new PlaneGeometry(4.6, 10.4), new MeshBasicMaterial({ map: softShadow(), transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.03;
  bus.add(shadow);
  const halo = new Mesh(new RingGeometry(4.6, 5.4, 48), new MeshBasicMaterial({ color: colours.halo, transparent: true, opacity: 0, depthWrite: false }));
  halo.rotation.x = -Math.PI / 2;
  halo.position.y = 0.05;
  bus.add(halo);

  return { bus, paints, halo };
}

export type BusOverlay = {
  /** A do-nothing layer in the map whose only job is to hand over the camera each time the map draws. */
  layer: CustomLayerInterface;
  /** Draws the bus where it is now. Cheap: the map itself isn't redrawn. */
  draw: () => void;
  remove: () => void;
};

/**
 * The bus on its own see-through canvas laid exactly over the map, with its own WebGL context.
 * Drawing it into the map's context looked simpler but left the map's street layers blank, and it
 * meant redrawing the whole map for every frame of the bus's drive. Kept apart, the bus can move
 * without the map lifting a finger, and nothing it does can upset the map. The price is that
 * buildings never hide it, which for a bus you're looking for is no loss.
 *
 * Throws if the browser won't give a second WebGL context; the caller keeps the flat marker then.
 */
export function createBusOverlay(map: MapLibre, layerId: string, getPose: () => BusPose | null, colours: BusColours): BusOverlay {
  const canvas = document.createElement('canvas');
  canvas.className = 'bus-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setClearColor(0x000000, 0);
  map.getCanvasContainer().appendChild(canvas);

  const scene = new Scene();
  const camera = new Camera();
  const { bus, paints, halo } = buildBus(colours);
  const grey = new Color('#8b919c');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const flip = new Matrix4().makeRotationX(Math.PI / 2);
  let shownLive: boolean | null = null;
  /** The map's camera, as of the last time it drew. */
  let view: number[] | null = null;
  let pulse = 0;
  let removed = false;

  scene.add(bus);
  scene.add(new HemisphereLight('#ffffff', '#5b6478', 1.5));
  const sun = new DirectionalLight('#ffffff', 2.1);
  // From the south-west and high: the side facing the viewer on a north-up map stays lit.
  sun.position.set(-0.55, 1, 0.75);
  scene.add(sun);

  function fit() {
    const box = map.getCanvas();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(box.clientWidth, box.clientHeight, false);
  }
  fit();

  function draw() {
    if (removed) return;
    const pose = getPose();
    if (!view) return map.triggerRepaint();
    if (!pose) return renderer.clear();

    if (shownLive !== pose.live) {
      shownLive = pose.live;
      // Old news is drawn drained of colour, like the flat marker was.
      for (const { material, base } of paints) material.color.copy(base).lerp(grey, pose.live ? 0 : 0.8);
    }
    const beating = pose.live && pose.moving && !reduced;
    const ring = halo.material as MeshBasicMaterial;
    if (beating) {
      const phase = (performance.now() % PULSE_MS) / PULSE_MS;
      halo.scale.setScalar(0.8 + phase * 0.9);
      ring.opacity = 0.42 * (1 - phase);
    } else {
      ring.opacity = 0;
    }

    const scale = Math.max(EXAGGERATE, (MIN_LENGTH_PX * metresPerPixel(pose.lat, map.getZoom())) / LENGTH_M);
    const origin = MercatorCoordinate.fromLngLat([pose.lng, pose.lat], 0);
    const unit = origin.meterInMercatorCoordinateUnits() * scale;
    bus.rotation.y = (-pose.bearing * Math.PI) / 180;
    const place = new Matrix4().makeTranslation(origin.x, origin.y, origin.z).scale(new Vector3(unit, -unit, unit)).multiply(flip);
    camera.projectionMatrix = new Matrix4().fromArray(view).multiply(place);
    renderer.render(scene, camera);

    // The ring keeps breathing between position updates, on this canvas alone.
    cancelAnimationFrame(pulse);
    if (beating) pulse = requestAnimationFrame(draw);
  }

  map.on('resize', fit);

  return {
    layer: {
      id: layerId,
      type: 'custom',
      renderingMode: '2d',
      // Touches nothing in the map's context: it only notes the camera and redraws the bus to match.
      render(_gl, args) {
        view = Array.from(args.defaultProjectionData.mainMatrix as ArrayLike<number>);
        draw();
      },
    },
    draw,
    remove() {
      removed = true;
      cancelAnimationFrame(pulse);
      map.off('resize', fit);
      canvas.remove();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
