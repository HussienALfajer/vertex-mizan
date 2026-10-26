import { accounting } from './accounting.js';
import { commandPalette } from './command-palette.js';
import { common } from './common.js';
import { designSystem } from './design-system.js';
import { errors } from './errors.js';
import { grid } from './grid.js';
import { shell } from './shell.js';
import { shortcuts } from './shortcuts.js';

/** The Arabic catalog, one namespace per file. */
export const ar = {
  common,
  accounting,
  grid,
  commandPalette,
  shortcuts,
  errors,
  designSystem,
  shell,
};

export type Catalog = typeof ar;
