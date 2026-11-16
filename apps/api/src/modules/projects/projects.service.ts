import { Inject, Injectable } from '@nestjs/common';
import type {
  CreateMaterial,
  CreateSubcontract,
  CurrencyCode,
  Material,
  MaterialPage,
  MaterialQuery,
  ProjectDocument,
  ProjectDocumentPage,
  ProjectDocumentQuery,
  ProjectDocumentSummary,
  ProjectTermsInput,
  ProjectTermsView,
  Subcontract,
  SubcontractList,
  SubcontractQuery,
  UpdateMaterial,
  UpdateSubcontract,
} from '@vertex-mizan/contracts';
import {
  archiveMaterial,
  createMaterial,
  createSubcontract,
  type Database,
  type ProjectDocumentRow,
  putProjectTerms,
  readMaterials,
  readProjectDocument,
  readProjectDocuments,
  readProjectTerms,
  readSubcontracts,
  type Transaction,
  updateMaterial,
  updateSubcontract,
  withCompany,
} from '@vertex-mizan/db';
import { actorOf, type CompanyRouteAccess } from '../../core/access/access.js';
import { lockCompanyForWrite } from '../../core/access/company-lock.js';
import { DATABASE } from '../../core/database/database.module.js';
import { CodedException } from '../../core/errors/coded-exception.js';
import { readEntry } from '../entries/entry-shape.js';

const summaryOf = (row: ProjectDocumentRow): ProjectDocumentSummary => ({
  id: row.document.id,
  kind: row.document.kind,
  fiscalYear: row.document.fiscalYear,
  number: row.document.number,
  projectSequence: row.document.projectSequence,
  documentDate: row.document.documentDate,
  contractValueId: row.document.contractValueId,
  counterpartyValueId: row.document.counterpartyValueId,
  side: row.document.side,
  currency: row.document.currency as CurrencyCode,
  totalMinor: row.document.totalMinor.toString(),
  supplierReference: row.document.supplierReference,
  entry: row.entry,
  cancelledBy: row.cancelledBy,
});

const minor = (value: bigint | null) => value?.toString() ?? null;

/**
 * Projects (S12 "API"): the materials catalogue, a project's terms and budget, subcontracts and the
 * register of project documents, through `packages/db`'s project services, which the scenario book
 * shares. Writes lock the company row first and are audited by the services; reads run in one
 * repeatable-read snapshot and are not audited.
 */
@Injectable()
export class ProjectsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

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

  materials(access: CompanyRouteAccess, query: MaterialQuery): Promise<MaterialPage> {
    return this.#read(access, (tx) => readMaterials(tx, query));
  }

  createMaterial(access: CompanyRouteAccess, input: CreateMaterial): Promise<Material> {
    return this.#write(access, (tx, companyId) =>
      createMaterial(tx, companyId, input, actorOf(access)),
    );
  }

  updateMaterial(
    access: CompanyRouteAccess,
    id: string,
    change: UpdateMaterial,
  ): Promise<Material> {
    return this.#write(access, (tx, companyId) =>
      updateMaterial(tx, companyId, id, change, actorOf(access)),
    );
  }

  archiveMaterial(access: CompanyRouteAccess, id: string): Promise<Material> {
    return this.#write(access, (tx, companyId) =>
      archiveMaterial(tx, companyId, id, actorOf(access)),
    );
  }

  terms(access: CompanyRouteAccess, valueId: string): Promise<ProjectTermsView> {
    return this.#read(access, (tx) => readProjectTerms(tx, valueId));
  }

  putTerms(
    access: CompanyRouteAccess,
    valueId: string,
    input: ProjectTermsInput,
  ): Promise<ProjectTermsView> {
    return this.#write(access, (tx, companyId) =>
      putProjectTerms(tx, companyId, valueId, input, actorOf(access)),
    );
  }

  async subcontracts(
    access: CompanyRouteAccess,
    query: SubcontractQuery,
  ): Promise<SubcontractList> {
    return { subcontracts: await this.#read(access, (tx) => readSubcontracts(tx, query)) };
  }

  createSubcontract(access: CompanyRouteAccess, input: CreateSubcontract): Promise<Subcontract> {
    return this.#write(access, (tx, companyId) =>
      createSubcontract(tx, companyId, input, actorOf(access)),
    );
  }

  updateSubcontract(
    access: CompanyRouteAccess,
    id: string,
    change: UpdateSubcontract,
  ): Promise<Subcontract> {
    return this.#write(access, (tx, companyId) =>
      updateSubcontract(tx, companyId, id, change, actorOf(access)),
    );
  }

  async documents(
    access: CompanyRouteAccess,
    query: ProjectDocumentQuery,
  ): Promise<ProjectDocumentPage> {
    const page = await this.#read(access, (tx) => readProjectDocuments(tx, query));
    return { documents: page.rows.map(summaryOf), nextCursor: page.nextCursor };
  }

  document(access: CompanyRouteAccess, id: string): Promise<ProjectDocument> {
    return this.#read(access, async (tx) => {
      const found = await readProjectDocument(tx, { id });
      if (found === null) throw new CodedException('NOT_FOUND', 'No such project document');
      const { document } = found;
      return {
        ...summaryOf(found),
        periodFrom: document.periodFrom,
        periodTo: document.periodTo,
        cumulativeMinor: minor(document.cumulativeMinor),
        previousMinor: minor(document.previousMinor),
        retentionMinor: minor(document.retentionMinor),
        advanceMinor: minor(document.advanceMinor),
        entryDetail: await readEntry(tx, document.entryId),
        quantities: found.quantities.map((row) => ({
          lineNo: row.lineNo,
          materialId: row.materialId,
          unit: row.unit,
          quantity: row.quantity,
          unitPrice: row.unitPrice,
        })),
        applications: found.applications.map((row) => ({
          advanceLineNo: row.advanceLineNo,
          lineNo: row.lineNo,
          amountMinor: row.amountMinor.toString(),
          bookMinor: row.bookMinor.toString(),
          parallelMinor: minor(row.parallelMinor),
        })),
      };
    });
  }
}
