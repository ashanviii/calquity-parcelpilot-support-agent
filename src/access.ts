/**
 * Access control. Enforced at the tool layer, never left to model instructions.
 */

export type UserType = 'customer' | 'support_staff' | 'operations_staff';

export interface AccessContext {
  userId: string;
  userType: UserType;
  accountId?: string;
  role?: string;
}

export interface AccessDecision {
  allowed: boolean;
  reason: string;
}

const ALLOW: AccessDecision = { allowed: true, reason: 'ok' };

export function isStaff(ctx: AccessContext): boolean {
  return ctx.userType === 'support_staff' || ctx.userType === 'operations_staff';
}

/** Normalises whatever the transport handed us into a context we are willing to act on. */
export function normalizeContext(raw: any, fallbackUserId: string): AccessContext {
  const userType: UserType =
    raw?.userType === 'support_staff' || raw?.userType === 'operations_staff'
      ? raw.userType
      : 'customer';

  return {
    userId: String(raw?.userId || fallbackUserId),
    userType,
    // An account scope is meaningless for staff and must never be trusted from a customer
    // beyond being the single account they are pinned to.
    accountId: userType === 'customer' ? String(raw?.accountId || '') || undefined : undefined,
    role: raw?.role ? String(raw.role) : undefined,
  };
}

/**
 * Documents are tagged with an audience. Customers see public policy only, plus the
 * contract belonging to their own account. Internal SOPs never leave the building.
 */
export function canReadDocument(
  ctx: AccessContext,
  doc: { audience: 'public' | 'internal'; accountId?: string },
): AccessDecision {
  if (isStaff(ctx)) return ALLOW;

  if (doc.audience === 'internal') {
    return { allowed: false, reason: 'Internal document; not available to customers.' };
  }
  if (doc.accountId && doc.accountId !== ctx.accountId) {
    return { allowed: false, reason: 'Agreement belongs to a different account.' };
  }
  return ALLOW;
}

/**
 * Record-level scoping. Compares the record's own accountId — the previous implementation
 * did `resourceId.startsWith(accountId)`, which compared "ORD-1001" against "ACC-001" and
 * therefore denied every legitimate customer lookup.
 */
export function canReadRecord(
  ctx: AccessContext,
  record: { accountId?: string } | undefined,
): AccessDecision {
  if (isStaff(ctx)) return ALLOW;
  if (!ctx.accountId) {
    return { allowed: false, reason: 'No account scope on this session.' };
  }
  if (!record?.accountId) {
    return { allowed: false, reason: 'Record is not account-scoped.' };
  }
  if (record.accountId !== ctx.accountId) {
    return { allowed: false, reason: 'Record belongs to a different account.' };
  }
  return ALLOW;
}

/** State-changing actions are staff-only. */
export function canPerformAction(ctx: AccessContext): AccessDecision {
  if (isStaff(ctx)) return ALLOW;
  return { allowed: false, reason: 'Only ParcelPilot staff can create or execute escalations.' };
}
