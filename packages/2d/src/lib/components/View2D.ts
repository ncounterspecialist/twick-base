import type {SimpleSignal} from '@twick/core';
import {PlaybackState, lazy} from '@twick/core';
import {initial, signal} from '../decorators';
import {nodeName} from '../decorators/nodeName';
import {useScene2D} from '../scenes/useScene2D';
import type {Node} from './Node';
import type {RectProps} from './Rect';
import {Rect} from './Rect';

export interface View2DProps extends RectProps {
  assetHash: string;
}

@nodeName('View2D')
export class View2D extends Rect {
  // TODO: scope this to individual player
  @lazy(() => {
    const frameID = 'twick-2d-frame';
    let frame = document.querySelector<HTMLDivElement>(`#${frameID}`);
    if (!frame) {
      frame = document.createElement('div');
      frame.id = frameID;
      frame.style.position = 'absolute';
      frame.style.pointerEvents = 'none';
      frame.style.top = '0';
      frame.style.left = '0';
      frame.style.fontFeatureSettings = 'normal'; // TODO: find solution that fully isolates CSS
      frame.style.opacity = '0';
      frame.style.overflow = 'hidden';
      document.body.prepend(frame);
    }
    return frame.shadowRoot ?? frame.attachShadow({mode: 'open'});
  })
  public static shadowRoot: ShadowRoot;

  @initial(PlaybackState.Paused)
  @signal()
  public declare readonly playbackState: SimpleSignal<PlaybackState, this>;

  @initial(0)
  @signal()
  public declare readonly globalTime: SimpleSignal<number, this>;

  @initial(0)
  @signal()
  public declare readonly fps: SimpleSignal<number, this>;

  @signal()
  public declare readonly assetHash: SimpleSignal<string, this>;

  public constructor(props: View2DProps) {
    super({
      composite: true,
      fontFamily: 'Roboto',
      fontSize: 48,
      lineHeight: '120%',
      textWrap: false,
      fontStyle: 'normal',
      ...props,
    });
    this.view2D = this;

    View2D.shadowRoot.append(this.element);
    this.applyFlex();
  }

  public override dispose() {
    this.removeChildren();
    super.dispose();
  }

  public override async render(context: CanvasRenderingContext2D) {
    this.computedSize();
    this.computedPosition();
    await super.render(context);
  }

  /**
   * Find a node by its key.
   *
   * @param key - The key of the node.
   */
  public findKey<T extends Node = Node>(key: string): T | null {
    return (useScene2D().getNode(key) as T) ?? null;
  }

  protected override requestLayoutUpdate() {
    this.updateLayout();
  }

  protected override requestFontUpdate() {
    this.applyFont();
  }

  public override view(): View2D {
    return this;
  }
}
