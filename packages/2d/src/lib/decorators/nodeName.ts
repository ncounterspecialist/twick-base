/**
 * @internal
 */
export const NODE_NAME = Symbol.for('@twick/2d/nodeName');

/**
 * @internal
 */
export function nodeName(name: string) {
  return function (target: any) {
    target.prototype[NODE_NAME] = name;
  };
}
