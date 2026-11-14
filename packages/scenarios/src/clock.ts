// Each case company's clock (`docs/scenarios/README.md`): the latest date of its steps so far,
// which a dated step moves forward and the actions that read today run at (S03 rule 6).

const clocks = new Map<string, string>();

/** The clock of a case's company moves with its dated steps (a manual entry, a reversal). */
export function advanceClock(companyId: string, on: string): void {
  if (on > (clocks.get(companyId) ?? '0000-01-01')) clocks.set(companyId, on);
}

/** The case's clock: the latest date of its steps so far. */
export function caseToday(companyId: string): string {
  return clocks.get(companyId) ?? '0000-01-01';
}

/** The first day of the month after `month` (`YYYY-MM`). */
export function dayAfterMonth(month: string): string {
  const [year, number] = month.split('-').map(Number) as [number, number];
  return number === 12 ? `${year + 1}-01-01` : `${year}-${String(number + 1).padStart(2, '0')}-01`;
}
