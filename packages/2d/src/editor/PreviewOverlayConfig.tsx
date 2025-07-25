import {transformVectorAsPoint, Vector2} from '@twick/core';
import type {PluginOverlayConfig} from '@twick/ui';
import {
  MouseButton,
  OverlayWrapper,
  useViewportContext,
  useViewportMatrix,
} from '@twick/ui';
import type {ComponentChildren} from 'preact';
import {usePluginState} from './Provider';

function Component({children}: {children?: ComponentChildren}) {
  const state = useViewportContext();
  const {scene, selectedKey} = usePluginState();
  const matrix = useViewportMatrix();

  return (
    <OverlayWrapper
      onPointerDown={event => {
        if (event.button !== MouseButton.Left || event.shiftKey) return;
        if (!scene.value) return;
        event.stopPropagation();

        const diff = new Vector2(
          event.x - state.rect.x,
          event.y - state.rect.y,
        );
        const position = transformVectorAsPoint(diff, matrix.inverse());

        selectedKey.value = scene.value.inspectPosition(
          position.x,
          position.y,
        ) as string;
      }}
    >
      {children}
    </OverlayWrapper>
  );
}

function drawHook() {
  const {selectedKey, hoveredKey, afterRender, scene} = usePluginState();
  selectedKey.value;
  hoveredKey.value;
  afterRender.value;

  return (ctx: CanvasRenderingContext2D, matrix: DOMMatrix) => {
    const currentScene = scene.peek();
    if (!currentScene) return;

    let node = currentScene.getNode(selectedKey.value);
    if (node) {
      currentScene.drawOverlay(node.key, matrix, ctx);
    }

    node = currentScene.getNode(hoveredKey.value);
    if (node && hoveredKey.value !== selectedKey.value) {
      ctx.globalAlpha = 0.5;
      currentScene.drawOverlay(hoveredKey.value, matrix, ctx);
    }
  };
}

export const PreviewOverlayConfig: PluginOverlayConfig = {
  drawHook,
  component: Component,
};
