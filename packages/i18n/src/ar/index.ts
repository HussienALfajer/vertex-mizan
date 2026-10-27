import { accounting } from './accounting.js';
import { audit } from './audit.js';
import { auth } from './auth.js';
import { commandPalette } from './command-palette.js';
import { common } from './common.js';
import { company } from './company.js';
import { designSystem } from './design-system.js';
import { email } from './email.js';
import { errors } from './errors.js';
import { grid } from './grid.js';
import { members } from './members.js';
import { permissions } from './permissions.js';
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
  company,
  members,
  permissions,
  audit,
};

export type Catalog = typeof ar;
