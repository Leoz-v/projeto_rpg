/**
 * PixiJS v8 + @pixi/3d viewport, lighting, OrbitCamera, WASD panning,
 * and 2D PixiJS HUD overlay container.
 */

import './pixi3dUnsafeEval';
import {
  Container3D,
  DirectionalLight,
  Ray,
  Vector3,
  View3D,
} from '@pixi/3d';
import { OrbitCamera } from '@pixi/3d/extras';
import { Application, Container, Text } from 'pixi.js';
import { DEFAULT_MAP_SIZE, TILE_SIZE_METERS } from '../terrain/constants';
import type { Ray3 } from '../terrain/raycast';
import { StylizedSkybox } from './skybox';

export type CameraViewMode = 'perspective' | 'orthographic' | 'top_down';

export class SceneManager {
  readonly app: Application;
  readonly view: View3D;
  readonly worldRoot: Container3D;
  readonly surfaceRoot: Container3D;
  readonly terrainRoot: Container3D;
  readonly liquidRoot: Container3D;
  readonly propsRoot: Container3D;
  readonly interiorRoot: Container3D;
  readonly interiorTerrainRoot: Container3D;
  readonly interiorLiquidRoot: Container3D;
  readonly interiorPropsRoot: Container3D;
  readonly lightsRoot: Container3D;
  readonly overlayRoot: Container3D;
  readonly hudLayer: Container;
  readonly skybox: StylizedSkybox;
  readonly sun: DirectionalLight;
  readonly orbit: OrbitCamera;

  private readonly heldKeys = new Set<string>();
  private readonly rayScratch = new Ray();
  private readonly rulerLabel: Text;
  private currentViewMode: CameraViewMode = 'perspective';
  private last3DPolar = 0.85;
  private last3DAzimuth = 0.72;
  private keyboardPanEnabled = true;
  private leftButtonMode: 'none' | 'pan' | 'rotate' = 'none';
  private readonly onKeyDown: (e: KeyboardEvent) => void;
  private readonly onKeyUp: (e: KeyboardEvent) => void;
  private readonly onBlur: () => void;
  private readonly onWebGlContextLost: (e: Event) => void;
  private readonly onWebGlContextRestored: () => void;
  private destroyed = false;

  onContextLost?: () => void;
  onContextRestored?: () => void;

  private constructor(
    app: Application,
    view: View3D,
    worldRoot: Container3D,
    surfaceRoot: Container3D,
    terrainRoot: Container3D,
    liquidRoot: Container3D,
    propsRoot: Container3D,
    interiorRoot: Container3D,
    interiorTerrainRoot: Container3D,
    interiorLiquidRoot: Container3D,
    interiorPropsRoot: Container3D,
    lightsRoot: Container3D,
    overlayRoot: Container3D,
    hudLayer: Container,
    skybox: StylizedSkybox,
    sun: DirectionalLight,
    orbit: OrbitCamera
  ) {
    this.app = app;
    this.view = view;
    this.worldRoot = worldRoot;
    this.surfaceRoot = surfaceRoot;
    this.terrainRoot = terrainRoot;
    this.liquidRoot = liquidRoot;
    this.propsRoot = propsRoot;
    this.interiorRoot = interiorRoot;
    this.interiorTerrainRoot = interiorTerrainRoot;
    this.interiorLiquidRoot = interiorLiquidRoot;
    this.interiorPropsRoot = interiorPropsRoot;
    this.lightsRoot = lightsRoot;
    this.overlayRoot = overlayRoot;
    this.hudLayer = hudLayer;
    this.skybox = skybox;
    this.sun = sun;
    this.orbit = orbit;

    this.rulerLabel = new Text({
      text: '',
      style: {
        fill: 0xffffff,
        fontFamily: 'Inter, Segoe UI, system-ui, sans-serif',
        fontSize: 13,
        fontWeight: '600',
        stroke: { color: 0x0b1018, width: 4 },
      },
    });
    this.rulerLabel.anchor.set(0.5, 1.3);
    this.rulerLabel.visible = false;
    this.hudLayer.addChild(this.rulerLabel);

    this.onKeyDown = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')) {
        return;
      }
      this.heldKeys.add(e.code);
    };
    this.onKeyUp = (e: KeyboardEvent): void => {
      this.heldKeys.delete(e.code);
    };
    this.onBlur = (): void => {
      this.heldKeys.clear();
    };
    this.onWebGlContextLost = (e: Event): void => {
      e.preventDefault();
      if (this.destroyed) return;
      this.app.ticker.stop();
      this.onContextLost?.();
    };
    this.onWebGlContextRestored = (): void => {
      if (this.destroyed) return;
      this.app.ticker.start();
      this.onContextRestored?.();
    };

    this.app.canvas.addEventListener('webglcontextlost', this.onWebGlContextLost);
    this.app.canvas.addEventListener('webglcontextrestored', this.onWebGlContextRestored);

    this.setupKeyboardPan();
  }

  static async create(hostElement: HTMLElement, mapWidth = DEFAULT_MAP_SIZE, mapLength = DEFAULT_MAP_SIZE): Promise<SceneManager> {
    const app = new Application();
    await app.init({
      resizeTo: hostElement,
      backgroundColor: 0x8ea9c4,
      antialias: true,
      preference: 'webgl',
    });
    hostElement.appendChild(app.canvas);

    const view = new View3D({
      autoResize: true,
      shadowQuality: 'medium',
      toneMapping: 'none',
      environment: {
        skyColor: 0xc2d8f0,
        groundColor: 0x524839,
        intensity: 0.62,
      },
      fog: {
        type: 'linear',
        color: 0x99b2c9,
        near: 52,
        far: 150,
      },
    });
    app.stage.addChild(view);

    const hudLayer = new Container();
    hudLayer.eventMode = 'none';
    app.stage.addChild(hudLayer);

    // Level content sits under worldRoot split into Surface (y = 0) and Interior (subterranean y < 0)
    const worldRoot = new Container3D({ label: 'worldRoot' });
    const surfaceRoot = new Container3D({ label: 'surfaceRoot' });
    const terrainRoot = new Container3D({ label: 'terrainRoot' });
    const liquidRoot = new Container3D({ label: 'liquidRoot' });
    const propsRoot = new Container3D({ label: 'propsRoot' });
    surfaceRoot.addChild(terrainRoot, liquidRoot, propsRoot);

    const interiorRoot = new Container3D({ label: 'interiorRoot' });
    const interiorTerrainRoot = new Container3D({ label: 'interiorTerrainRoot' });
    const interiorLiquidRoot = new Container3D({ label: 'interiorLiquidRoot' });
    const interiorPropsRoot = new Container3D({ label: 'interiorPropsRoot' });
    interiorRoot.addChild(interiorTerrainRoot, interiorLiquidRoot, interiorPropsRoot);
    interiorRoot.visible = false;

    const lightsRoot = new Container3D({ label: 'lightsRoot' });
    const overlayRoot = new Container3D({ label: 'overlayRoot' });
    worldRoot.addChild(surfaceRoot, interiorRoot, lightsRoot, overlayRoot);

    const skybox = new StylizedSkybox(280);
    view.root.addChild(skybox.mesh);
    view.root.addChild(worldRoot);

    // Directional sun aligned with WorldLab's default daylight azimuth/elevation
    const centerX = (mapWidth * TILE_SIZE_METERS) / 2;
    const centerZ = (mapLength * TILE_SIZE_METERS) / 2;

    const sun = new DirectionalLight({
      color: 0xfff5e4,
      intensity: 2.7,
      castShadow: true,
    });
    sun.position.set(centerX - 24, 34, centerZ + 30);
    sun.lookAt({ x: centerX, y: 0, z: centerZ });
    view.root.addChild(sun);

    // Position camera overlooking the encounter map
    view.camera.fov = 48;
    view.camera.near = 0.25;
    view.camera.far = 350;
    view.camera.position.set(centerX + 26, 26, centerZ + 30);
    view.camera.lookAt({ x: centerX, y: 0.5, z: centerZ });

    const orbit = new OrbitCamera({
      view,
      target: { x: centerX, y: 0.5, z: centerZ },
      enableDamping: true,
      dampingFactor: 0.14,
      minDistance: 4.5,
      maxDistance: 120,
      minPolarAngle: 0.001,
      maxPolarAngle: Math.PI / 2 - 0.04,
      screenSpacePanning: false,
      mouseButtons: {
        left: 'none',
        middle: 'pan',
        right: 'rotate',
      },
      autoUpdate: false,
    });

    skybox.syncToCamera(view.camera.position, view.camera.far);

    return new SceneManager(
      app,
      view,
      worldRoot,
      surfaceRoot,
      terrainRoot,
      liquidRoot,
      propsRoot,
      interiorRoot,
      interiorTerrainRoot,
      interiorLiquidRoot,
      interiorPropsRoot,
      lightsRoot,
      overlayRoot,
      hudLayer,
      skybox,
      sun,
      orbit
    );
  }

  /** Positions the subterranean Interior layer cleanly underneath Surface at `offsetY` (in meters, typically negative). */
  setInteriorOffsetY(offsetY: number): void {
    this.interiorRoot.position.y = offsetY;
  }

  /** Shifts both orbit target and camera Y together when switching between Surface and Interior layers. */
  shiftCameraElevation(deltaY: number): void {
    if (Math.abs(deltaY) < 1e-5) return;
    this.orbit.target.y += deltaY;
    this.view.camera.position.y += deltaY;
    this.orbit.update();
    this.skybox.syncToCamera(this.view.camera.position, this.view.camera.far);
  }

  private setupKeyboardPan(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);

    const moveVec = new Vector3();

    this.app.ticker.add((ticker) => {
      const dt = Math.min(0.05, ticker.deltaMS / 1000);
      let forward = 0;
      let strafe = 0;
      if (this.keyboardPanEnabled) {
        if (this.heldKeys.has('KeyW') || this.heldKeys.has('ArrowUp')) forward += 1;
        if (this.heldKeys.has('KeyS') || this.heldKeys.has('ArrowDown')) forward -= 1;
        if (this.heldKeys.has('KeyD') || this.heldKeys.has('ArrowRight')) strafe += 1;
        if (this.heldKeys.has('KeyA') || this.heldKeys.has('ArrowLeft')) strafe -= 1;
      }

      if (forward !== 0 || strafe !== 0) {
        const speed = Math.max(8, this.orbit.distance * 0.72) * dt;
        const az = this.orbit.azimuthAngle;
        // Forward on XZ plane is toward orbit target (-sin(az), -cos(az))
        const fwdX = -Math.sin(az);
        const fwdZ = -Math.cos(az);
        const rightX = Math.cos(az);
        const rightZ = -Math.sin(az);
        const dx = (fwdX * forward + rightX * strafe) * speed;
        const dz = (fwdZ * forward + rightZ * strafe) * speed;
        moveVec.set(dx, 0, dz);
        this.orbit.target.add(moveVec);
        this.view.camera.position.add(moveVec);
      }

      this.orbit.update(ticker);
      this.skybox.syncToCamera(this.view.camera.position, this.view.camera.far);
    });
  }

  get viewMode(): CameraViewMode {
    return this.currentViewMode;
  }

  setKeyboardPanEnabled(enabled: boolean): void {
    this.keyboardPanEnabled = enabled;
    if (!enabled) this.heldKeys.clear();
  }

  /** Define a ação do botão esquerdo na câmera (`'pan'` na mesa, `'rotate'` na ferramenta Orbit do editor, `'none'` ao desenhar/arrastar). */
  setLeftButtonAction(action: 'none' | 'pan' | 'rotate'): void {
    this.leftButtonMode = action;
    this.orbit.mouseButtons.left = this.currentViewMode === 'top_down' && action === 'rotate' ? 'pan' : action;
  }

  setLeftButtonOrbitMode(enabled: boolean): void {
    this.setLeftButtonAction(enabled ? 'rotate' : 'none');
  }

  setCameraViewMode(mode: CameraViewMode): void {
    const prevMode = this.currentViewMode;
    if (prevMode !== 'top_down') {
      this.last3DPolar = Math.max(0.25, Math.min(Math.PI / 2 - 0.06, this.orbit.polarAngle || 0.85));
      this.last3DAzimuth = this.orbit.azimuthAngle;
    }

    this.currentViewMode = mode;
    const t = this.orbit.target;
    const dist = Math.max(12, Math.min(90, this.orbit.distance || 42));

    if (mode === 'top_down') {
      this.view.camera.mode = 'orthographic';
      this.view.camera.orthographicSize = Math.max(12, dist * 0.58);
      this.view.camera.zoom = 1;
      this.orbit.enableRotate = false;
      this.orbit.minPolarAngle = 0.001;
      this.orbit.maxPolarAngle = 0.01;
      this.orbit.mouseButtons.right = 'pan';
      this.orbit.mouseButtons.left = this.leftButtonMode === 'rotate' ? 'pan' : this.leftButtonMode;
      // Position straight above target with tiny +Z epsilon so North (-Z) stays cleanly up
      this.view.camera.position.set(t.x, t.y + dist, t.z + 0.05);
      this.view.camera.lookAt({ x: t.x, y: t.y, z: t.z });
      this.orbit.update();
      return;
    }

    // Restore 3D orbit bounds & controls
    this.orbit.enableRotate = true;
    this.orbit.minPolarAngle = 0.08;
    this.orbit.maxPolarAngle = Math.PI / 2 - 0.04;
    this.orbit.mouseButtons.right = 'rotate';
    this.orbit.mouseButtons.left = this.leftButtonMode;

    if (mode === 'orthographic') {
      this.view.camera.mode = 'orthographic';
      this.view.camera.orthographicSize = Math.max(12, dist * 0.52);
      this.view.camera.zoom = 1;
    } else {
      this.view.camera.mode = 'perspective';
      this.view.camera.fov = 48;
      this.view.camera.zoom = 1;
    }

    if (prevMode === 'top_down') {
      const sinP = Math.sin(this.last3DPolar);
      const cosP = Math.cos(this.last3DPolar);
      this.view.camera.position.set(
        t.x + dist * sinP * Math.sin(this.last3DAzimuth),
        t.y + dist * cosP,
        t.z + dist * sinP * Math.cos(this.last3DAzimuth)
      );
      this.view.camera.lookAt({ x: t.x, y: t.y, z: t.z });
      this.orbit.update();
    }
  }

  resetCameraToMap(mapWidth: number, mapLength: number): void {
    const worldW = mapWidth * TILE_SIZE_METERS;
    const worldL = mapLength * TILE_SIZE_METERS;
    const maxSpan = Math.max(worldW, worldL);
    const cx = worldW / 2;
    const cz = worldL / 2;

    this.orbit.maxDistance = Math.max(90, maxSpan * 2.6);
    this.view.camera.far = Math.max(350, maxSpan * 5.5);
    this.orbit.target.set(cx, 0.5, cz);

    if (this.currentViewMode === 'top_down') {
      const dist = Math.max(24, maxSpan * 0.9);
      this.view.camera.position.set(cx, dist, cz + 0.05);
      this.view.camera.orthographicSize = Math.max(14, maxSpan * 0.58);
      this.view.camera.zoom = 1;
    } else {
      const factor = maxSpan / 48; // 48 m = 32-tile baseline
      this.view.camera.position.set(cx + 26 * factor, Math.max(12, 26 * factor), cz + 30 * factor);
      if (this.currentViewMode === 'orthographic') {
        this.view.camera.orthographicSize = Math.max(14, maxSpan * 0.54);
        this.view.camera.zoom = 1;
      }
    }
    this.view.camera.lookAt({ x: cx, y: 0.5, z: cz });
    this.orbit.update();
    this.skybox.syncToCamera(this.view.camera.position, this.view.camera.far);
  }

  /** Re-centers directional sun, shadow bounds, and camera framing for a newly created or loaded map. */
  configureForMap(mapWidth: number, mapLength: number): void {
    const worldW = mapWidth * TILE_SIZE_METERS;
    const worldL = mapLength * TILE_SIZE_METERS;
    const maxSpan = Math.max(worldW, worldL);
    const cx = worldW / 2;
    const cz = worldL / 2;
    const sunScale = Math.max(0.6, maxSpan / 48);

    this.sun.position.set(cx - 24 * sunScale, 34 * sunScale, cz + 30 * sunScale);
    this.sun.lookAt({ x: cx, y: 0, z: cz });
    this.resetCameraToMap(mapWidth, mapLength);
    this.fitSunShadows();
  }

  /** Convert client viewport coordinates to a world-space Ray3. */
  clientPointToRay(clientX: number, clientY: number): Ray3 {
    const rect = this.app.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const ray = this.view.screenToRay({ x, y }, this.rayScratch);
    return {
      originX: ray.origin.x,
      originY: ray.origin.y,
      originZ: ray.origin.z,
      dirX: ray.direction.x,
      dirY: ray.direction.y,
      dirZ: ray.direction.z,
    };
  }

  /** Update the floating 2D D&D ruler badge above a 3D midpoint. */
  setRulerLabel(worldPoint: { x: number; y: number; z: number } | null, text: string): void {
    if (!worldPoint || !text) {
      this.rulerLabel.visible = false;
      return;
    }
    const screenPos = this.view.worldToScreen(worldPoint);
    if (!screenPos) {
      this.rulerLabel.visible = false;
      return;
    }
    this.rulerLabel.text = text;
    this.rulerLabel.position.set(screenPos.x, screenPos.y);
    this.rulerLabel.visible = true;
  }

  setEnvironmentAndAtmosphere(opts: {
    skyColor: number;
    groundColor: number;
    ambientIntensity: number;
    backdropColor: number;
    fogEnabled: boolean;
    fogColor: number;
    fogNear: number;
    fogFar: number;
  }): void {
    this.view.environment = {
      skyColor: opts.skyColor,
      groundColor: opts.groundColor,
      intensity: opts.ambientIntensity,
    };
    this.view.fog = opts.fogEnabled
      ? {
          type: 'linear',
          color: opts.fogColor,
          near: opts.fogNear,
          far: opts.fogFar,
        }
      : null;
    this.app.renderer.background.color = opts.backdropColor;
    const parent = this.app.canvas.parentElement;
    if (parent) {
      parent.style.background = `#${opts.backdropColor.toString(16).padStart(6, '0')}`;
    }
  }

  fitSunShadows(): void {
    this.sun.fitShadowBounds();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    this.app.canvas.removeEventListener('webglcontextlost', this.onWebGlContextLost);
    this.app.canvas.removeEventListener('webglcontextrestored', this.onWebGlContextRestored);
    this.heldKeys.clear();
    this.orbit.destroy();
    this.skybox.destroy();
    this.app.destroy({ removeView: true, releaseGlobalResources: false }, { children: true });
  }
}
