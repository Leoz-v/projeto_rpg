import {
  Container,
  EventBoundary,
  extensions,
  FederatedContainer,
  FederatedPointerEvent,
  Graphics,
  Rectangle,
  Sprite,
  Texture,
} from 'pixi.js';
import { describe, expect, it } from 'vitest';
import { createWorldLayers } from './MapStage';

extensions.mixin(Container, FederatedContainer);

function syncWorldTransforms(node: Container, parent?: Container): void {
  node.updateLocalTransform();
  const matrix = parent ? parent.worldTransform.clone().append(node.localTransform) : node.localTransform.clone();
  Object.defineProperty(node, 'worldTransform', { value: matrix, configurable: true });
  for (const child of node.children) {
    syncWorldTransforms(child, node);
  }
}

function pointerEvent(boundary: EventBoundary, type: string, x: number, y: number, button: number): FederatedPointerEvent {
  const event = new FederatedPointerEvent(boundary);
  event.type = type;
  event.global.set(x, y);
  event.button = button;
  return event;
}

describe('MapStage 2D layer hit-testing and drag/pan isolation', () => {
  it('hits a token through fog, fog preview, and ruler overlays', () => {
    const stage = new Container();
    stage.eventMode = 'static';
    stage.hitArea = new Rectangle(0, 0, 800, 600);

    const { world, tokenLayer, fogLayer, fogPreviewLayer, rulerLayer } = createWorldLayers();
    stage.addChild(world);

    const token = new Container();
    token.addChild(new Graphics().circle(50, 50, 46).fill(0x8f7cf7));
    token.eventMode = 'static';
    token.position.set(100, 100);
    tokenLayer.addChild(token);

    const fogSprite = new Sprite(Texture.WHITE);
    fogSprite.width = 800;
    fogSprite.height = 600;
    fogLayer.addChild(fogSprite);

    fogPreviewLayer.rect(0, 0, 800, 600).fill({ color: 0x6c5ce7, alpha: 0.35 });
    rulerLayer.circle(150, 150, 100).fill({ color: 0xff7849, alpha: 0.18 });

    syncWorldTransforms(stage);

    const boundary = new EventBoundary(stage);
    expect(boundary.hitTest(150, 150)).toBe(token);
    expect(boundary.hitTest(400, 400)).toBe(stage);
  });

  it('stops left-click propagation on a token so stage pan does not trigger', () => {
    const stage = new Container();
    stage.eventMode = 'static';
    stage.hitArea = new Rectangle(0, 0, 800, 600);

    const { world, tokenLayer, fogLayer } = createWorldLayers();
    stage.addChild(world);

    const token = new Container();
    token.addChild(new Graphics().circle(50, 50, 46).fill(0x8f7cf7));
    token.eventMode = 'static';
    token.position.set(100, 100);
    tokenLayer.addChild(token);

    const fogSprite = new Sprite(Texture.WHITE);
    fogSprite.width = 800;
    fogSprite.height = 600;
    fogLayer.addChild(fogSprite);

    syncWorldTransforms(stage);

    const calls: string[] = [];
    token.on('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      calls.push('tokenDown');
    });
    stage.on('pointerdown', () => {
      calls.push('stageDown');
    });

    const boundary = new EventBoundary(stage);
    boundary.mapEvent(pointerEvent(boundary, 'pointerdown', 150, 150, 0));
    expect(calls).toEqual(['tokenDown']);

    calls.length = 0;
    boundary.mapEvent(pointerEvent(boundary, 'pointerdown', 150, 150, 1));
    expect(calls).toEqual(['stageDown']);

    calls.length = 0;
    boundary.mapEvent(pointerEvent(boundary, 'pointerdown', 400, 400, 0));
    expect(calls).toEqual(['stageDown']);
  });

  it('places tokenLayer inside sceneLayer and keeps tokens clickable through lightTint, wall lines, and light overlays', () => {
    const stage = new Container();
    stage.eventMode = 'static';
    stage.hitArea = new Rectangle(0, 0, 800, 600);

    const { world, sceneLayer, lightTintLayer, tokenLayer, fogLayer, wallOverlayLayer, lightOverlayLayer, fogPreviewLayer, rulerLayer } =
      createWorldLayers();
    stage.addChild(world);

    expect(sceneLayer.children).toContain(tokenLayer);
    expect(sceneLayer.children).toContain(lightTintLayer);

    const token = new Container();
    token.addChild(new Graphics().circle(50, 50, 46).fill(0x8f7cf7));
    token.eventMode = 'static';
    token.position.set(100, 100);
    tokenLayer.addChild(token);

    const lightTint = new Sprite(Texture.WHITE);
    lightTint.width = 800;
    lightTint.height = 600;
    lightTintLayer.addChild(lightTint);

    const wallLines = new Graphics().moveTo(0, 0).lineTo(400, 400).stroke({ width: 6, color: 0xf59e0b });
    wallLines.eventMode = 'none';
    wallOverlayLayer.addChild(wallLines);

    const selfMarker = new Graphics().circle(150, 150, 44).stroke({ width: 4, color: 0xa78bfa });
    selfMarker.eventMode = 'none';
    lightOverlayLayer.addChild(selfMarker);

    const fogSprite = new Sprite(Texture.WHITE);
    fogSprite.width = 800;
    fogSprite.height = 600;
    fogLayer.addChild(fogSprite);

    fogPreviewLayer.rect(0, 0, 800, 600).fill({ color: 0x6c5ce7, alpha: 0.35 });
    rulerLayer.circle(150, 150, 100).fill({ color: 0xff7849, alpha: 0.18 });

    syncWorldTransforms(stage);

    const boundary = new EventBoundary(stage);
    expect(boundary.hitTest(150, 150)).toBe(token);
  });
});
