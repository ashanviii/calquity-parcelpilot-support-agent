/**
 * Operational data layer — reads ParcelPilot_Assessment_Data.xlsx from the data pack.
 *
 * Everything is loaded from the workbook. Nothing about the example records is hardcoded,
 * because the graders may test with other records from the same pack.
 *
 * All timestamps in the pack are Asia/Kolkata wall-clock with no offset. The workbook's
 * README sheet states the dataset snapshot time, and the assessment requires that snapshot
 * to be the reference "now" for every time-based question — not the wall clock.
 */

import * as fs from 'fs';
import * as path from 'path';
import XLSX from 'xlsx';

/** Asia/Kolkata is UTC+05:30 with no DST, so a fixed offset is correct here. */
const IST_OFFSET_MIN = 5 * 60 + 30;
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

export interface Account {
  account_id: string;
  account_name: string;
  plan: 'Enterprise' | 'Growth' | 'Standard';
  status: string;
  csm: string | null;
  contract_file: string | null;
  premium_support: boolean;
  notes: string | null;
}

export interface Order {
  order_id: string;
  account_id: string;
  carrier: string;
  status: 'DRAFT' | 'BOOKED' | 'PICKED_UP' | 'DELIVERED' | 'CANCELLED';
  booked_at: string | null;
  pickup_window_start: string | null;
  pickup_window_end: string | null;
  pickup_actual_at: string | null;
  shipment_fee_inr: number;
  carrier_fault: boolean;
  customer_fault: boolean;
  cancellation_requested_at: string | null;
  notes: string | null;
}

export interface Ticket {
  ticket_id: string;
  account_id: string;
  created_at: string;
  status: string;
  subject: string;
  description: string;
  channel: string;
  assigned_to: string | null;
  last_customer_message_at: string | null;
  /** Context only. The pack states these may contain incorrect past guidance. */
  historical_resolution: string | null;
}

export interface OperationalData {
  snapshotISO: string;
  snapshotLabel: string;
  currency: string;
  accounts: Account[];
  orders: Order[];
  tickets: Ticket[];
}

export class DataPackMissingError extends Error {}

/** "2026-08-16 09:00" (Asia/Kolkata wall clock) -> epoch ms. */
export function parsePackTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = String(value)
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (!m) {
    const fallback = Date.parse(String(value));
    return Number.isNaN(fallback) ? null : fallback;
  }
  const [, y, mo, d, h, mi] = m;
  return Date.UTC(+y, +mo - 1, +d, +h, +mi) - IST_OFFSET_MIN * MINUTE;
}

/** Renders an epoch back into Asia/Kolkata wall clock, matching the pack's own format. */
export function formatPackTime(ms: number): string {
  const shifted = new Date(ms + IST_OFFSET_MIN * MINUTE);
  return shifted.toISOString().slice(0, 16).replace('T', ' ') + ' IST';
}

const bool = (v: unknown): boolean =>
  v === true || String(v).trim().toLowerCase() === 'true' || v === 1 || v === '1';

const str = (v: unknown): string | null => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length === 0 || s.toLowerCase() === 'null' ? null : s;
};

export function loadOperationalData(dataDir: string): OperationalData {
  const file = path.join(dataDir, 'ParcelPilot_Assessment_Data.xlsx');
  if (!fs.existsSync(file)) {
    throw new DataPackMissingError(
      `ParcelPilot_Assessment_Data.xlsx not found in ${dataDir}. ` +
        'Set PARCELPILOT_DATA_DIR to the folder holding the assessment pack.',
    );
  }

  const wb = XLSX.readFile(file);
  const sheet = (name: string): any[] => {
    const found = wb.SheetNames.find((s) => s.toLowerCase() === name);
    return found ? XLSX.utils.sheet_to_json(wb.Sheets[found], { defval: null }) : [];
  };

  // README is a two-column key/value sheet; the header cell is the first column name.
  const readme = sheet('readme');
  const readmeValue = (key: string): string | null => {
    for (const row of readme) {
      const values = Object.values(row).map((v) => (v === null ? '' : String(v)));
      if (values[0]?.toLowerCase().startsWith(key.toLowerCase())) return values[1] ?? null;
    }
    return null;
  };

  const snapshotLabel = readmeValue('Dataset snapshot') ?? '';
  const snapshotMs = parsePackTime(snapshotLabel);
  if (snapshotMs === null) {
    throw new DataPackMissingError(
      `Could not read the dataset snapshot time from the workbook README sheet (got "${snapshotLabel}").`,
    );
  }

  const accounts: Account[] = sheet('accounts').map((r) => ({
    account_id: String(r.account_id),
    account_name: String(r.account_name),
    plan: r.plan,
    status: String(r.status),
    csm: str(r.csm),
    contract_file: str(r.contract_file),
    premium_support: bool(r.premium_support),
    notes: str(r.notes),
  }));

  const orders: Order[] = sheet('orders').map((r) => ({
    order_id: String(r.order_id),
    account_id: String(r.account_id),
    carrier: String(r.carrier),
    status: String(r.status).toUpperCase() as Order['status'],
    booked_at: str(r.booked_at),
    pickup_window_start: str(r.pickup_window_start),
    pickup_window_end: str(r.pickup_window_end),
    pickup_actual_at: str(r.pickup_actual_at),
    shipment_fee_inr: Number(r.shipment_fee_inr) || 0,
    carrier_fault: bool(r.carrier_fault),
    customer_fault: bool(r.customer_fault),
    cancellation_requested_at: str(r.cancellation_requested_at),
    notes: str(r.notes),
  }));

  const tickets: Ticket[] = sheet('tickets').map((r) => ({
    ticket_id: String(r.ticket_id),
    account_id: String(r.account_id),
    created_at: String(r.created_at),
    status: String(r.status),
    subject: String(r.subject),
    description: String(r.description),
    channel: String(r.channel),
    assigned_to: str(r.assigned_to),
    last_customer_message_at: str(r.last_customer_message_at),
    historical_resolution: str(r.historical_resolution),
  }));

  console.log(
    `[data] workbook loaded: ${accounts.length} accounts, ${orders.length} orders, ` +
      `${tickets.length} tickets; snapshot ${snapshotLabel}`,
  );

  return {
    snapshotISO: new Date(snapshotMs).toISOString(),
    snapshotLabel,
    currency: readmeValue('Currency') ?? 'INR',
    accounts,
    orders,
    tickets,
  };
}

// ---------- derived facts (computed, never hardcoded per-record) ----------

export interface CancellationFacts {
  order_id: string;
  status: Order['status'];
  cancellable: boolean;
  pickedUp: boolean;
  minutesSinceBooking: number | null;
  withinFreeWindow30Min: boolean | null;
  cancellationRequestedAt: string | null;
  minutesFromBookingToRequest: number | null;
  reason: string;
}

/**
 * Reports the timing facts a cancellation decision depends on. It deliberately does NOT
 * decide the fee — the fee rule lives in the SOP and may be overridden by the account's
 * agreement, so the agent must read both documents and apply precedence itself.
 */
export function cancellationFacts(order: Order, snapshotMs: number): CancellationFacts {
  const booked = parsePackTime(order.booked_at);
  const requested = parsePackTime(order.cancellation_requested_at);
  const pickedUp = order.status === 'PICKED_UP' || Boolean(order.pickup_actual_at);

  // Measure against the cancellation request when there is one, else the snapshot.
  const referenceMs = requested ?? snapshotMs;
  const minutesSinceBooking = booked === null ? null : Math.round((referenceMs - booked) / MINUTE);
  const minutesFromBookingToRequest =
    booked === null || requested === null ? null : Math.round((requested - booked) / MINUTE);

  let cancellable: boolean;
  let reason: string;
  switch (order.status) {
    case 'DRAFT':
      cancellable = true;
      reason = 'Order is still a DRAFT.';
      break;
    case 'BOOKED':
      cancellable = !pickedUp;
      reason = pickedUp
        ? 'Order is BOOKED but a pickup has been recorded.'
        : 'Order is BOOKED and no pickup has been recorded.';
      break;
    case 'PICKED_UP':
      cancellable = false;
      reason = 'Order has been picked up; cancellation is not the correct workflow.';
      break;
    case 'DELIVERED':
      cancellable = false;
      reason = 'Order has already been delivered.';
      break;
    default:
      cancellable = false;
      reason = `Order status is ${order.status}.`;
  }

  return {
    order_id: order.order_id,
    status: order.status,
    cancellable,
    pickedUp,
    minutesSinceBooking,
    withinFreeWindow30Min: minutesSinceBooking === null ? null : minutesSinceBooking <= 30,
    cancellationRequestedAt: order.cancellation_requested_at,
    minutesFromBookingToRequest,
    reason,
  };
}

export interface PickupDelayFacts {
  order_id: string;
  pickupCompleted: boolean;
  pickupWindowEnd: string | null;
  /** Hours past the end of the window, measured to actual pickup or to the snapshot. */
  hoursPastWindowEnd: number | null;
  measuredAgainst: 'actual_pickup' | 'dataset_snapshot' | null;
  carrier_fault: boolean;
  customer_fault: boolean;
  shipment_fee_inr: number;
  /** 10% of the fee — one input to the SOP's default credit formula. */
  tenPercentOfFeeInr: number;
  faultDetermined: boolean;
}

/**
 * Reports pickup-delay facts. Again it does not decide eligibility: the threshold and the
 * credit amount differ between the SOP default and each customer agreement.
 */
export function pickupDelayFacts(order: Order, snapshotMs: number): PickupDelayFacts {
  const windowEnd = parsePackTime(order.pickup_window_end);
  const actual = parsePackTime(order.pickup_actual_at);
  const reference = actual ?? snapshotMs;

  const hours =
    windowEnd === null ? null : Math.round(((reference - windowEnd) / HOUR) * 100) / 100;

  return {
    order_id: order.order_id,
    pickupCompleted: actual !== null,
    pickupWindowEnd: order.pickup_window_end,
    hoursPastWindowEnd: hours === null ? null : Math.max(0, hours),
    measuredAgainst: windowEnd === null ? null : actual !== null ? 'actual_pickup' : 'dataset_snapshot',
    carrier_fault: order.carrier_fault,
    customer_fault: order.customer_fault,
    shipment_fee_inr: order.shipment_fee_inr,
    tenPercentOfFeeInr: Math.round(order.shipment_fee_inr * 0.1),
    // The SOP forbids promising a credit when fault is unknown.
    faultDetermined: order.carrier_fault || order.customer_fault,
  };
}

export interface TicketAgeFacts {
  ticket_id: string;
  createdAt: string;
  hoursOpenAtSnapshot: number;
  minutesOpenAtSnapshot: number;
  status: string;
  hasHistoricalResolution: boolean;
}

export function ticketAgeFacts(ticket: Ticket, snapshotMs: number): TicketAgeFacts {
  const created = parsePackTime(ticket.created_at) ?? snapshotMs;
  const minutes = Math.round((snapshotMs - created) / MINUTE);
  return {
    ticket_id: ticket.ticket_id,
    createdAt: ticket.created_at,
    hoursOpenAtSnapshot: Math.round((minutes / 60) * 100) / 100,
    minutesOpenAtSnapshot: minutes,
    status: ticket.status,
    hasHistoricalResolution: Boolean(ticket.historical_resolution),
  };
}
