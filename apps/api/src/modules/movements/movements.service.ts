import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  type Branding,
  type CancelMovement,
  type CreateParty,
  type CreateProject,
  type Dashboard,
  type DayRates,
  LOGO_MAX_BYTES,
  type MaterialCostQuery,
  type MaterialCosts,
  type Movement,
  type MovementPage,
  type MovementQuery,
  type Party,
  type PartyType,
  type Project,
  type ProjectQuery,
  type RecordDayRates,
  type RecordMovement,
  type UpdateBranding,
  type UpdateProject,
} from '@vertex-mizan/contracts';
import {
  cancelMovement,
  createParty,
  createProject,
  type Database,
  readBranding,
  readDashboard,
  readDayRates,
  readMaterialCosts,
  readMovement,
  readMovements,
  readParties,
  readProjects,
  recordDayRates,
  recordMovement,
  type Transaction,
  updateBranding,
  updateProject,
  withCompany,
} from '@vertex-mizan/db';
import { v7 as uuidv7 } from 'uuid';
import { actorOf, type CompanyRouteAccess } from '../../core/access/access.js';
import { lockCompanyForWrite } from '../../core/access/company-lock.js';
import { todayInDamascus } from '../../core/clock/today.js';
import type { Config } from '../../core/config/config.js';
import { CONFIG } from '../../core/config/config.module.js';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/coded-exception.js';
import { attachmentTypeOf, FileStore } from '../../core/files/file-store.js';
import type { UploadedAttachment } from '../../core/files/upload.js';

/** A logo as served: its bytes and type. */
export interface LogoFile {
  readonly body: Buffer;
  readonly contentType: string;
}

/**
 * S13's project movements (ADR 0024): movements and their cancellation, projects with their
 * figures, clients and suppliers, material costs, the day's rates, the dashboard and the company's
 * branding, through `packages/db`'s movements service. Writes lock the company row first; reads run
 * in one repeatable-read snapshot.
 */
@Injectable()
export class MovementsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(FileStore) private readonly files: FileStore,
    @Inject(CONFIG) private readonly config: Config,
  ) {}

  #read<T>(access: CompanyRouteAccess, work: (tx: Transaction) => Promise<T>): Promise<T> {
    return withCompany(this.db, access.company.id, work, { isolationLevel: 'repeatable read' });
  }

  #write<T>(
    access: CompanyRouteAccess,
    work: (tx: Transaction, companyId: string) => Promise<T>,
  ): Promise<T> {
    const companyId = access.company.id;
    return withCompany(this.db, companyId, async (tx) => {
      await lockCompanyForWrite(tx, companyId);
      return work(tx, companyId);
    });
  }

  #context(access: CompanyRouteAccess, companyId: string) {
    return { companyId, actor: actorOf(access), today: todayInDamascus() };
  }

  movements(access: CompanyRouteAccess, query: MovementQuery): Promise<MovementPage> {
    return this.#read(access, (tx) => readMovements(tx, query));
  }

  record(access: CompanyRouteAccess, input: RecordMovement): Promise<Movement> {
    return this.#write(access, async (tx, companyId) => {
      const id = await recordMovement(tx, this.#context(access, companyId), input);
      return readMovement(tx, id);
    });
  }

  cancel(access: CompanyRouteAccess, id: string, input: CancelMovement): Promise<Movement> {
    return this.#write(access, async (tx, companyId) => {
      await cancelMovement(tx, this.#context(access, companyId), id, input);
      return readMovement(tx, id);
    });
  }

  projects(access: CompanyRouteAccess, query: ProjectQuery): Promise<Project[]> {
    return this.#read(access, (tx) => readProjects(tx, query));
  }

  async project(access: CompanyRouteAccess, id: string): Promise<Project> {
    return this.#read(access, (tx) => projectOrNotFound(tx, id));
  }

  createProject(access: CompanyRouteAccess, input: CreateProject): Promise<Project> {
    return this.#write(access, async (tx, companyId) => {
      const id = await createProject(tx, companyId, actorOf(access), input);
      return projectOrNotFound(tx, id);
    });
  }

  updateProject(access: CompanyRouteAccess, id: string, input: UpdateProject): Promise<Project> {
    return this.#write(access, async (tx, companyId) => {
      await updateProject(tx, companyId, actorOf(access), id, input);
      return projectOrNotFound(tx, id);
    });
  }

  parties(access: CompanyRouteAccess, type: PartyType): Promise<Party[]> {
    return this.#read(access, (tx) => readParties(tx, type));
  }

  createParty(access: CompanyRouteAccess, input: CreateParty): Promise<Party> {
    return this.#write(access, async (tx, companyId) => {
      const id = await createParty(tx, companyId, actorOf(access), input);
      const party = (await readParties(tx, input.type)).find((row) => row.id === id);
      if (party === undefined) throw new Error('The party was not created');
      return party;
    });
  }

  materialCosts(access: CompanyRouteAccess, query: MaterialCostQuery): Promise<MaterialCosts> {
    return this.#read(access, (tx) => readMaterialCosts(tx, query));
  }

  dayRates(access: CompanyRouteAccess, date: string | undefined): Promise<DayRates> {
    return this.#read(access, (tx) => readDayRates(tx, date ?? todayInDamascus()));
  }

  recordDayRates(access: CompanyRouteAccess, input: RecordDayRates): Promise<DayRates> {
    return this.#write(access, async (tx, companyId) => {
      await recordDayRates(tx, companyId, actorOf(access), input);
      return readDayRates(tx, input.date);
    });
  }

  dashboard(access: CompanyRouteAccess): Promise<Dashboard> {
    return this.#read(access, (tx) => readDashboard(tx, todayInDamascus()));
  }

  branding(access: CompanyRouteAccess): Promise<Branding> {
    return this.#read(access, async (tx) => brandingOf(await readBranding(tx)));
  }

  updateBranding(access: CompanyRouteAccess, input: UpdateBranding): Promise<Branding> {
    return this.#write(access, async (tx, companyId) => {
      await updateBranding(tx, companyId, actorOf(access), { displayName: input.displayName });
      return brandingOf(await readBranding(tx));
    });
  }

  /** Stores a PNG or JPEG of at most 1 MB as the logo (S13 "Data"); the type from its bytes. */
  async uploadLogo(
    access: CompanyRouteAccess,
    file: UploadedAttachment | undefined,
  ): Promise<Branding> {
    if (file === undefined) {
      throw new CodedException('VALIDATION_FAILED', 'A logo file is required', [
        { path: ['file'], message: 'Required' },
      ]);
    }
    if (file.buffer.length > LOGO_MAX_BYTES) {
      throw new CodedException('ATTACHMENT_TOO_LARGE', 'A logo is at most 1 MB');
    }
    const contentType = attachmentTypeOf(file.buffer);
    if (contentType !== 'image/png' && contentType !== 'image/jpeg') {
      throw new CodedException('ATTACHMENT_TYPE', 'A logo is a PNG or a JPEG');
    }
    const companyId = access.company.id;
    const id = uuidv7();
    return this.#write(access, async (tx) => {
      // Written once the company row is locked (an archived company is refused first).
      await this.files.write(companyId, id, file.buffer);
      await updateBranding(tx, companyId, actorOf(access), {
        logo: {
          storageKey: `${companyId}/${id}`,
          contentType,
          sha256: createHash('sha256').update(file.buffer).digest('hex'),
        },
      });
      return brandingOf(await readBranding(tx));
    });
  }

  logo(access: CompanyRouteAccess): Promise<LogoFile> {
    return this.#logoOf(access.company.id);
  }

  /** The sign-in page's branding (S13 "Data"): the company the server's setting names, only. */
  async publicBranding(): Promise<Branding> {
    const companyId = this.config.signInCompanyId;
    if (companyId === null) return { displayName: '', hasLogo: false, logoVersion: null };
    return withCompany(this.db, companyId, async (tx) => brandingOf(await readBranding(tx)));
  }

  publicLogo(): Promise<LogoFile> {
    const companyId = this.config.signInCompanyId;
    if (companyId === null) throw new CodedException('NOT_FOUND', 'No logo');
    return this.#logoOf(companyId);
  }

  async #logoOf(companyId: string): Promise<LogoFile> {
    const branding = await withCompany(this.db, companyId, readBranding);
    if (branding.logo === null) throw new CodedException('NOT_FOUND', 'No logo');
    const [owner, id] = branding.logo.storageKey.split('/');
    if (owner !== companyId || id === undefined) throw new CodedException('NOT_FOUND', 'No logo');
    return { body: await this.files.read(companyId, id), contentType: branding.logo.contentType };
  }
}

async function projectOrNotFound(tx: Transaction, id: string): Promise<Project> {
  const [project] = await readProjects(tx, { id });
  if (project === undefined) throw new CodedException('NOT_FOUND', 'No such project');
  return project;
}

function brandingOf(row: Awaited<ReturnType<typeof readBranding>>): Branding {
  return {
    displayName: row.displayName,
    hasLogo: row.logo !== null,
    logoVersion: row.logo === null ? null : row.logo.sha256.slice(0, 16),
  };
}
