import { Inject, Injectable } from '@nestjs/common';
import {
  type Account,
  CHART_TEMPLATES,
  type ChartTemplateId,
  type ChartTemplateSummary,
  STATEMENT_LINES,
} from '@vertex-mizan/contracts';
import { type Database, dimensionTypes, withCompany } from '@vertex-mizan/db';
import { ar } from '@vertex-mizan/i18n';
import ExcelJS from 'exceljs';
import { actorOf, type CompanyRouteAccess } from '../../core/access/access.js';
import { lockCompanyForWrite } from '../../core/access/company-lock.js';
import { writeCompanyAudit } from '../../core/audit/audit.js';
import { DATABASE } from '../../core/database/database.module.js';
import { applyChartTemplate, readChart } from './chart-shape.js';

/** A file the API answers with. */
export interface ExportFile {
  readonly fileName: string;
  readonly contentType: string;
  readonly body: Buffer;
}

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** The chart as a whole: its templates, the statement-line catalogue and the export (S02). */
@Injectable()
export class ChartService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** `GET /api/chart/templates`: each template's summary; its accounts include the five roots. */
  templates(): ChartTemplateSummary[] {
    return CHART_TEMPLATES.map((template) => ({
      id: template.id,
      version: template.version,
      name: template.name,
      nameLatin: template.nameLatin,
      accountCount: template.accounts.length,
    }));
  }

  /** `POST /api/chart/apply-template` (rule 1): to a chart of the five roots alone. */
  async applyTemplate(access: CompanyRouteAccess, templateId: ChartTemplateId): Promise<Account[]> {
    const companyId = access.company.id;
    return withCompany(this.db, companyId, async (tx) => {
      await lockCompanyForWrite(tx, companyId);
      await applyChartTemplate(tx, companyId, templateId, actorOf(access));
      return readChart(tx, false);
    });
  }

  /**
   * `GET /api/chart/export?format=xlsx`: every account with its fields, archived ones included, as
   * `GET /api/accounts?includeArchived=true` answers them, in an Arabic right-to-left sheet; SYP
   * under its printed name (ADR 0007). Audited `export.chart` (S01 rule 24) in the transaction
   * that reads the chart.
   */
  async export(access: CompanyRouteAccess): Promise<ExportFile> {
    const companyId = access.company.id;
    const { accounts, types } = await withCompany(this.db, companyId, async (tx) => {
      const accounts = await readChart(tx, true);
      const types = await tx
        .select({ id: dimensionTypes.id, name: dimensionTypes.name })
        .from(dimensionTypes);
      await writeCompanyAudit(tx, companyId, actorOf(access), {
        action: 'export.chart',
        entityType: 'chart',
        entityId: null,
        after: { format: 'xlsx' },
      });
      return { accounts, types };
    });
    return {
      fileName: 'chart-of-accounts.xlsx',
      contentType: XLSX,
      body: await chartWorkbook(accounts, new Map(types.map((type) => [type.id, type.name]))),
    };
  }
}

/** The chart's workbook: one sheet, one row per account, the columns of `ar.chart.export`. */
export async function chartWorkbook(
  accounts: readonly Account[],
  typeNames: ReadonlyMap<string, string>,
): Promise<Buffer> {
  const text = ar.chart;
  const yesNo = (value: boolean) => (value ? text.export.yes : text.export.no);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(text.title, { views: [{ rightToLeft: true }] });
  sheet.columns = [
    { header: text.export.code, key: 'code', width: 12 },
    { header: text.export.name, key: 'name', width: 40 },
    { header: text.export.nameLatin, key: 'nameLatin', width: 36 },
    { header: text.export.level, key: 'level', width: 8 },
    { header: text.export.kind, key: 'kind', width: 14 },
    { header: text.export.class, key: 'class', width: 14 },
    { header: text.export.normalBalance, key: 'normalBalance', width: 12 },
    { header: text.export.statementLine, key: 'statementLine', width: 40 },
    { header: text.export.currency, key: 'currency', width: 24 },
    { header: text.export.control, key: 'control', width: 12 },
    { header: text.export.monetary, key: 'monetary', width: 12 },
    { header: text.export.requiredDimensions, key: 'requiredDimensions', width: 24 },
    { header: text.export.roles, key: 'roles', width: 30 },
    { header: text.export.blocked, key: 'blocked', width: 30 },
    { header: text.export.archived, key: 'archived', width: 30 },
  ];
  // Codes stay text, so a code is never read as a number.
  sheet.getColumn('code').numFmt = '@';
  sheet.getRow(1).font = { bold: true };
  for (const account of accounts) {
    const line = STATEMENT_LINES.find((candidate) => candidate.code === account.statementLine);
    sheet.addRow({
      code: account.code,
      name: account.name,
      nameLatin: account.nameLatin ?? '',
      level: account.level,
      kind: text.kinds[account.kind],
      class: text.classes[account.class],
      normalBalance: text.normalBalances[account.normalBalance],
      statementLine: line?.name ?? '',
      currency:
        account.currency === null
          ? ''
          : account.currency === 'SYP'
            ? ar.accounting.sypPrintedName
            : ar.accounting.currencies[account.currency],
      control: yesNo(account.isControl),
      monetary: yesNo(account.isMonetary),
      requiredDimensions: account.requiredDimensionTypeIds
        .map((id) => typeNames.get(id) ?? '')
        .join('، '),
      roles: account.roles.map((role) => text.roles[role]).join('، '),
      blocked: account.blocked?.reason ?? '',
      archived: account.archived?.reason ?? '',
    });
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
