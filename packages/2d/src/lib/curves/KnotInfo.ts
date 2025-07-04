import type {Vector2} from '@twick/core';

export type KnotAutoHandles = {start: number; end: number};

export interface KnotInfo {
  position: Vector2;
  startHandle: Vector2;
  endHandle: Vector2;
  auto: KnotAutoHandles;
}
