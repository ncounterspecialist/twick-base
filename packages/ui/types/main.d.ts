import type {Project} from '@twick/core';

export function editor(project: Project): void;

export function index(
  projects: {
    name: string;
    url: string;
  }[],
): void;
