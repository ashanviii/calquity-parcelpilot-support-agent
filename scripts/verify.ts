/**
 * Smoke test for the parts that must not regress: access control, retrieval authority
 * ordering, the derived calculations, and the confirm-before-execute contract.
 *
 * Runs entirely against the data pack — no API key needed.
 *   npm run verify
 */

import * as path from 'path';
import { fileURLToPath } from 'url';
import { KnowledgeBase } from '../src/knowledge.js';
import { loadOperationalData, parsePackTime } from '../src/data.js';
import { buildToolkit } from '../src/tools.js';
import type { AccessContext } from '../src/access.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.PARCELPILOT_DATA_DIR ?? path.join(HERE, '..', 'data');

const db = loadOperationalData(DATA_DIR);
const kb = await KnowledgeBase.load(DATA_DIR, db.tickets);

const northstar: AccessContext = { userId: 'c1', userType: 'customer', accountId: 'ACCT-001' };
const lumen: AccessContext = { userId: 'c2', userType: 'customer', accountId: 'ACCT-002' };
const beacon: AccessContext = { userId: 'c3', userType: 'customer', accountId: 'ACCT-003' };
const staff: AccessContext = { userId: 's1', userType: 'support_staff' };

let pass = 0;
let fail = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (cond) {
    pass++;
    console.log(`  PASS  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL  ${name}  ${detail}`);
  }
};

const call = async (ctx: AccessContext, tool: string, args: any) => {
  const kit = buildToolkit(ctx, kb, db);
  const t = kit.tools.find((x) => x.name === tool)!;
  return JSON.parse(await t.func(args));
};

console.log('\n-- data pack loaded --');
check('all six pack documents indexed',
  [...kb.docs.values()].filter((d) => d.kind !== 'historical_ticket').length === 6,
  [...kb.docs.keys()].join(','));
check('dataset snapshot is the workbook README value',
  db.snapshotLabel.startsWith('2026-08-16 11:00'), db.snapshotLabel);
check('snapshot parsed as Asia/Kolkata (UTC+5:30)',
  db.snapshotISO === '2026-08-16T05:30:00.000Z', db.snapshotISO);
check('historical ticket resolutions indexed as sources',
  [...kb.docs.values()].filter((d) => d.kind === 'historical_ticket').length === 2);

console.log('\n-- access control: records --');
const own = await call(northstar, 'data_lookup', { resource: 'order', id: 'ORD-1001' });
check('ACCT-001 customer reads its own ORD-1001', own.order?.order_id === 'ORD-1001');

const cross = await call(lumen, 'data_lookup', { resource: 'order', id: 'ORD-1001' });
check('ACCT-002 customer is DENIED ORD-1001', cross.error === 'access_denied', JSON.stringify(cross));

const spoof = await call(lumen, 'data_lookup', { resource: 'order', accountId: 'ACCT-001' });
check('customer cannot widen scope via the accountId argument',
  Array.isArray(spoof.orders) && spoof.orders.every((o: any) => o.account_id === 'ACCT-002'),
  JSON.stringify(spoof.orders?.map((o: any) => o.order_id)));

const crossTicket = await call(beacon, 'data_lookup', { resource: 'ticket', id: 'TKT-505' });
check('ACCT-003 customer is DENIED another account ticket', crossTicket.error === 'access_denied');

check('staff reads any order',
  (await call(staff, 'data_lookup', { resource: 'order', id: 'ORD-1001' })).order?.order_id === 'ORD-1001');

console.log('\n-- access control: documents --');
const lumenSearch = await call(lumen, 'document_search', {
  query: 'Northstar cancellation no fee enterprise agreement',
});
check('customer never sees another account agreement',
  !(lumenSearch.results ?? []).some((r: any) => r.source.startsWith('05_')),
  (lumenSearch.results ?? []).map((r: any) => r.source).join(','));

const ownContract = await call(northstar, 'document_search', { query: 'cancellation fee before pickup' });
check('customer DOES see its own agreement',
  (ownContract.results ?? []).some((r: any) => r.source.startsWith('05_')),
  (ownContract.results ?? []).map((r: any) => r.source).join(','));

const crossHistory = await call(lumen, 'document_search', { query: 'cancellation fee after 30 minutes' });
check("customer never sees another account's past tickets",
  !(crossHistory.results ?? []).some((r: any) => r.source === 'ticket:TKT-450'),
  (crossHistory.results ?? []).map((r: any) => r.source).join(','));

console.log('\n-- retrieval authority --');
const canc = await call(northstar, 'document_search', { query: 'cancel booked shipment cancellation fee' });
check('ACCT-001 agreement outranks the SOP for its own cancellation question',
  canc.results[0].source === '05_Northstar_Logistics_Enterprise_Agreement.pdf',
  canc.results.map((r: any) => `${r.source}:${r.score}`).join(' | '));

const sla = await call(staff, 'document_search', { query: 'first response target P1 P2 P3 enterprise plan' });
const v2 = sla.results.find((r: any) => r.source.startsWith('02_'));
const v3 = sla.results.find((r: any) => r.source.startsWith('01_'));
check('deprecated policy v2 is flagged superseded when returned', !v2 || v2.superseded === true);
check('current policy v3 outranks deprecated v2', !v2 || !v3 || v3.score > v2.score,
  sla.results.map((r: any) => `${r.source}:${r.score}`).join(' | '));

const hist = await call(northstar, 'document_search', { query: 'cancellation fee after 30 minutes' });
const histHit = (hist.results ?? []).find((r: any) => r.kind === 'historical_ticket');
check('past ticket resolution is retrieved', Boolean(histHit),
  (hist.results ?? []).map((r: any) => r.source).join(' | '));
check('past ticket resolution is marked low reliability', histHit?.reliability === 'low');
check('past ticket resolution carries a context-only trust note',
  /CONTEXT ONLY/i.test(histHit?.trustNote ?? ''));

// The contradicting ticket scores below every current source by design, so it used to fall
// outside the cut on longer queries and the conflict silently disappeared. It must survive
// whatever phrasing the model happens to choose.
for (const q of [
  'Can I cancel this order without a fee?',
  'cancel shipment before pickup fee',
  'cancellation fee waiver booked shipment not yet picked up policy',
]) {
  const r = await call(northstar, 'document_search', { query: q });
  const t = (r.results ?? []).find((x: any) => x.kind === 'historical_ticket');
  check(`contradicting ticket survives the cut: "${q}"`, Boolean(t),
    (r.results ?? []).map((x: any) => x.source).join(' | '));
  check(`contradicting ticket never outranks a current source: "${q}"`,
    !t || r.results[0].kind !== 'historical_ticket');
}

console.log('\n-- calculations (measured against the dataset snapshot) --');
const f1001 = await call(northstar, 'compute_case_facts', { orderId: 'ORD-1001' });
check('ORD-1001 is cancellable (BOOKED, no pickup)', f1001.cancellation.cancellable === true);
check('ORD-1001 cancellation requested 120 min after booking',
  f1001.cancellation.minutesFromBookingToRequest === 120,
  String(f1001.cancellation.minutesFromBookingToRequest));
check('ORD-1001 is outside the 30-minute free window',
  f1001.cancellation.withinFreeWindow30Min === false);
check('ORD-1001 surfaces the account agreement as the next thing to read',
  /05_Northstar/.test(String(f1001.nextStep)), String(f1001.nextStep));

const f1002 = await call(northstar, 'compute_case_facts', { orderId: 'ORD-1002' });
check('ORD-1002 (PICKED_UP) is not cancellable', f1002.cancellation.cancellable === false);

const f3001 = await call(beacon, 'compute_case_facts', { orderId: 'ORD-3001' });
check('ORD-3001 is inside the 30-minute free window',
  f3001.cancellation.withinFreeWindow30Min === true,
  String(f3001.cancellation.minutesFromBookingToRequest));
check('ORD-3001 account has no agreement, so defaults apply',
  /no signed agreement/i.test(String(f3001.nextStep)), String(f3001.nextStep));

const f2002 = await call(lumen, 'compute_case_facts', { orderId: 'ORD-2002' });
check('ORD-2002 pickup is 4.5h past window end at snapshot',
  f2002.pickupDelay.hoursPastWindowEnd === 4.5, String(f2002.pickupDelay.hoursPastWindowEnd));
check('ORD-2002 delay measured against the snapshot, not the wall clock',
  f2002.pickupDelay.measuredAgainst === 'dataset_snapshot');
check('ORD-2002 carrier fault is established', f2002.pickupDelay.faultDetermined === true);
check('ORD-2002 exposes 10% of the shipment fee for the SOP formula',
  f2002.pickupDelay.tenPercentOfFeeInr === 240, String(f2002.pickupDelay.tenPercentOfFeeInr));

const tkt = await call(staff, 'compute_case_facts', { ticketId: 'TKT-501' });
check('TKT-501 has been open 30 min at snapshot',
  tkt.ticket.minutesOpenAtSnapshot === 30, String(tkt.ticket.minutesOpenAtSnapshot));

const tkt450 = await call(staff, 'compute_case_facts', { ticketId: 'TKT-450' });
check('a ticket with a past resolution warns that it may be wrong',
  /may contain incorrect/i.test(String(tkt450.historicalResolutionWarning)));

console.log('\n-- state-changing actions --');
const custAction = await call(northstar, 'create_escalation', {
  action: 'issue_service_credit', summary: 'credit me', creditAmountInr: 300,
});
check('customer CANNOT create an escalation', custAction.error === 'access_denied');

const staffAction = await call(staff, 'create_escalation', {
  action: 'escalate_ticket', summary: 'Escalate TKT-501 (P1 outage)', ticketId: 'TKT-501',
});
check('staff proposal requires confirmation and does not execute',
  staffAction.requiresConfirmation === true && typeof staffAction.actionId === 'string');

const bigCredit = await call(staff, 'create_escalation', {
  action: 'issue_service_credit', summary: 'large credit', orderId: 'ORD-2002', creditAmountInr: 1500,
});
check('credit above INR 1,000 flags manager approval (SOP v4 §3)',
  /manager approval/i.test(bigCredit.approvalNote ?? ''), JSON.stringify(bigCredit.approvalNote));

const smallCredit = await call(staff, 'create_escalation', {
  action: 'issue_service_credit', summary: 'small credit', orderId: 'ORD-2002', creditAmountInr: 300,
});
check('credit within INR 1,000 is inside the agent threshold',
  /within the INR 1,000/i.test(smallCredit.approvalNote ?? ''));

const ghost = await call(staff, 'create_escalation', {
  action: 'cancel_order', summary: 'cancel', orderId: 'ORD-9999',
});
check('cannot propose an action against a non-existent record', ghost.error === 'not_found');

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);
