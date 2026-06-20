import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/**
 * Default camera framing used when no model is loaded yet, and as the
 * baseline that `frameObject` adjusts once a VRM is loaded.
 */
const DEFAULT_CAMERA_POSITION = new THREE.Vector3(0, 1.4, 2.4);
const DEFAULT_TARGET = new THREE.Vector3(0, 1.0, 0);

/**
 * Owns the renderer, scene, camera, lights, and orbit controls.
 * Handles canvas resizing and exposes a render-loop hook.
 */
export class SceneManager {
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly controls: OrbitControls;

  private readonly clock = new THREE.Clock();
  private readonly updateCallbacks = new Set<(delta: number, elapsed: number) => void>();
  private resizeObserver: ResizeObserver | null = null;
  private readonly defaultBackground = new THREE.Color(0x14161a);
  private readonly textureLoader = new THREE.TextureLoader();
  private backgroundTexture: THREE.Texture | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.scene = new THREE.Scene();
    this.scene.background = this.defaultBackground;

    this.camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    this.camera.position.copy(DEFAULT_CAMERA_POSITION);

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.85;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.copy(DEFAULT_TARGET);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 0.5;
    this.controls.maxDistance = 10;
    this.controls.update();

    this.setupLighting();
    this.setupGround();
    this.handleResize();
    this.observeResize(canvas);

    this.renderer.setAnimationLoop(this.tick);
  }

  /** Adds a callback invoked once per frame with delta and elapsed time. */
  onUpdate(callback: (delta: number, elapsed: number) => void): void {
    this.updateCallbacks.add(callback);
  }

  removeUpdate(callback: (delta: number, elapsed: number) => void): void {
    this.updateCallbacks.delete(callback);
  }

  /** Restores the camera and controls target to the default framing. */
  resetView(): void {
    this.camera.position.copy(DEFAULT_CAMERA_POSITION);
    this.controls.target.copy(DEFAULT_TARGET);
    this.controls.update();
  }

  /**
   * Frames the camera and controls target around the given object's
   * bounding box, keeping the current viewing direction.
   */
  frameObject(object: THREE.Object3D): void {
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) {
      this.resetView();
      return;
    }

    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    const maxDimension = Math.max(size.x, size.y, size.z);
    const fitDistance = maxDimension / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    const distance = fitDistance * 1.6;

    // Look at the upper-chest area rather than the geometric center, which
    // tends to sit too low for humanoid avatars.
    const target = new THREE.Vector3(center.x, center.y + size.y * 0.1, center.z);

    const direction = new THREE.Vector3(0, 0, 1);
    this.camera.position.copy(target).addScaledVector(direction, distance);
    this.camera.position.y += size.y * 0.05;

    this.controls.target.copy(target);
    this.controls.update();
  }

  /** Loads an image as the scene background, replacing any previous one. */
  async setBackgroundImage(file: Blob): Promise<void> {
    const url = URL.createObjectURL(file);

    try {
      const texture = await this.textureLoader.loadAsync(url);
      texture.colorSpace = THREE.SRGBColorSpace;

      this.disposeBackgroundTexture();
      this.backgroundTexture = texture;
      this.scene.background = texture;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /** Restores the default solid-color background. */
  resetBackground(): void {
    this.disposeBackgroundTexture();
    this.scene.background = this.defaultBackground;
  }

  private disposeBackgroundTexture(): void {
    this.backgroundTexture?.dispose();
    this.backgroundTexture = null;
  }

  private setupLighting(): void {
    const hemisphere = new THREE.HemisphereLight(0xffffff, 0x3a3f4a, 0.35);
    this.scene.add(hemisphere);

    const ambient = new THREE.AmbientLight(0xffffff, 0.25);
    this.scene.add(ambient);

    const keyLight = new THREE.DirectionalLight(0xffffff, 1.1);
    keyLight.position.set(1, 2.2, 1.5);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.bias = -0.0005;
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xb9ccff, 0.25);
    fillLight.position.set(-2, 1, -1);
    this.scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xffffff, 0.25);
    rimLight.position.set(0, 2, -3);
    this.scene.add(rimLight);
  }

  private setupGround(): void {
    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(5, 48),
      new THREE.MeshStandardMaterial({ color: 0x1d2026, roughness: 1, metalness: 0 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.scene.add(ground);

    const grid = new THREE.GridHelper(5, 20, 0x3a3f4a, 0x24272e);
    grid.position.y = 0.001;
    this.scene.add(grid);
  }

  private observeResize(canvas: HTMLCanvasElement): void {
    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    if (canvas.parentElement) {
      this.resizeObserver.observe(canvas.parentElement);
    }
    window.addEventListener('resize', this.handleResize);
  }

  private handleResize = (): void => {
    const parent = this.renderer.domElement.parentElement;
    const width = parent?.clientWidth ?? window.innerWidth;
    const height = parent?.clientHeight ?? window.innerHeight;

    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  };

  private tick = (): void => {
    const delta = this.clock.getDelta();
    const elapsed = this.clock.getElapsedTime();

    this.controls.update();
    for (const callback of this.updateCallbacks) {
      callback(delta, elapsed);
    }

    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    this.renderer.setAnimationLoop(null);
    this.resizeObserver?.disconnect();
    window.removeEventListener('resize', this.handleResize);
    this.controls.dispose();
    this.renderer.dispose();
    this.disposeBackgroundTexture();
  }
}
