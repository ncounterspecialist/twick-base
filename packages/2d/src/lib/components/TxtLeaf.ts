import type {SignalValue, SimpleSignal} from '@twick/core';
import {BBox, capitalize, lazy, textLerp} from '@twick/core';
import {
  computed,
  initial,
  interpolation,
  nodeName,
  signal,
} from '../decorators';
import type {ShapeProps} from './Shape';
import {Shape} from './Shape';

export interface TxtLeafProps extends ShapeProps {
  children?: string;
  text?: SignalValue<string>;
}

export const TXT_TYPE = Symbol('Txt');

@nodeName('TxtLeaf')
export class TxtLeaf extends Shape {
  @lazy(() => {
    try {
      return new (Intl as any).Segmenter(undefined, {
        granularity: 'grapheme',
      });
    } catch (e) {
      return null;
    }
  })
  protected static readonly segmenter: any;

  @initial('')
  @interpolation(textLerp)
  @signal()
  public declare readonly text: SimpleSignal<string, this>;

  public constructor({children, ...rest}: TxtLeafProps) {
    super(rest);
    if (children) {
      this.text(children);
    }
  }

  @computed()
  protected parentTxt() {
    const parent = this.parent();
    if (!parent) {
      return null;
    }

    if (!(TXT_TYPE in parent)) {
      return null;
    }

    return parent;
  }

  protected override async draw(context: CanvasRenderingContext2D) {
    this.requestFontUpdate();
    this.applyStyle(context);
    await document.fonts?.ready;
    this.applyText(context);
    context.font = this.styles.font;
    context.textBaseline = 'bottom';
    if ('letterSpacing' in context) {
      context.letterSpacing = `${this.letterSpacing()}px`;
    }
    const fontOffset = context.measureText('').fontBoundingBoxAscent;

    const parentRect = this.element.getBoundingClientRect();
    const {width, height} = this.size();
    const range = document.createRange();
    let line = '';
    const lineRect = new BBox();
    for (const childNode of this.element.childNodes) {
      if (!childNode.textContent) {
        continue;
      }

      range.selectNodeContents(childNode);
      const rangeRect = range.getBoundingClientRect();

      const x = width / -2 + rangeRect.left - parentRect.left;
      const y = height / -2 + rangeRect.top - parentRect.top + fontOffset;

      if (lineRect.y === y) {
        lineRect.width += rangeRect.width;
        line += childNode.textContent;
      } else {
        await this.drawText(context, line, lineRect);
        lineRect.x = x;
        lineRect.y = y;
        lineRect.width = rangeRect.width;
        lineRect.height = rangeRect.height;
        line = childNode.textContent;
      }
    }

    await this.drawText(context, line, lineRect);
  }

  protected async drawText(
    context: CanvasRenderingContext2D,
    text: string,
    box: BBox,
  ) {
    const y = box.y;
    text = text.replace(/\s+/g, ' ');
    if (this.lineWidth() <= 0) {
      context.fillText(text, box.x, y);
    } else if (this.strokeFirst()) {
      context.strokeText(text, box.x, y);
      context.fillText(text, box.x, y);
    } else {
      context.fillText(text, box.x, y);
      context.strokeText(text, box.x, y);
    }
  }

  protected override getCacheBBox(): BBox {
    const size = this.computedSize();
    const range = document.createRange();
    range.selectNodeContents(this.element);
    const bbox = range.getBoundingClientRect();

    const lineWidth = this.lineWidth();
    // We take the default value of the miterLimit as 10.
    const miterLimitCoefficient = this.lineJoin() === 'miter' ? 0.5 * 10 : 0.5;

    return new BBox(-size.width / 2, -size.height / 2, bbox.width, bbox.height)
      .expand([0, this.fontSize() * 0.5])
      .expand(lineWidth * miterLimitCoefficient);
  }

  protected override applyFlex() {
    super.applyFlex();
    this.element.style.display = 'inline';
  }

  protected override updateLayout() {
    this.applyFont();
    this.applyFlex();

    // Make sure the text is aligned correctly even if the text is smaller than
    // the container.
    if (this.justifyContent.isInitial()) {
      this.element.style.justifyContent =
        this.styles.getPropertyValue('text-align');
    }

    const wrap =
      this.styles.whiteSpace !== 'nowrap' && this.styles.whiteSpace !== 'pre';

    if (wrap) {
      this.element.innerText = '';

      if (TxtLeaf.segmenter) {
        for (const word of TxtLeaf.segmenter.segment(this.text())) {
          this.element.appendChild(document.createTextNode(word.segment));
        }
      } else {
        for (const word of this.text().split('')) {
          this.element.appendChild(document.createTextNode(word));
        }
      }
    } else if (this.styles.whiteSpace === 'pre') {
      this.element.innerText = '';
      for (const line of this.text().split('\n')) {
        this.element.appendChild(document.createTextNode(line + '\n'));
      }
    } else {
      this.element.innerText = this.text();
    }
  }
}

/**
 * Overwrite all getters for signal values to return the parent value if it
 * exists.
 *
 * The getters on the TxtLeaf class are used by the `@signal` decorators and
 * are not used by the class or its consumers directly.
 *
 * Check out 2d/src/lib/utils/makeSignalExtensions.ts if this is confusing.
 */
[
  'fill',
  'stroke',
  'lineWidth',
  'strokeFirst',
  'lineCap',
  'lineJoin',
  'lineDash',
  'lineDashOffset',
].forEach(prop => {
  (TxtLeaf.prototype as any)[`get${capitalize(prop)}`] = function (
    this: TxtLeaf,
  ) {
    return (
      (this.parentTxt() as any)?.[prop]() ??
      (this as any)[prop].context.getInitial()
    );
  };
});
