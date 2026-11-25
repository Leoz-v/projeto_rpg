import { Container, EventBoundary, extensions, FederatedContainer, Graphics, Rectangle, Sprite, Texture } from 'pixi.js';
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

describe('MapStage 2D layer hit-testing', () => {
  it('hits a single token even when fog, fog preview, and ruler overlays cover the map', () => {
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
});
