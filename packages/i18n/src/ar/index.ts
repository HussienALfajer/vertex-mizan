import { accounting } from './accounting.js';
import { auth } from './auth.js';
import { commandPalette } from './command-palette.js';
import { common } from './common.js';
import { designSystem } from './design-system.js';
import { email } from './email.js';
import { errors } from './errors.js';
import { grid } from './grid.js';
import { roles } from './roles.js';
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
  roles,
  email,
  auth,
};

export type Catalog = typeof ar;
