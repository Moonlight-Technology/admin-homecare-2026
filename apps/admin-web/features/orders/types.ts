/** Shapes returned by the order API (S6). Money arrives as exact decimal strings; instants are UTC ISO. */
import type { FulfillmentMode } from '@/features/catalog/types';

export type OrderRow = {
  id: string;
  code: string;
  status: string;
  assignmentStatus: string;
  paymentStatus: string;
  mode: FulfillmentMode;
  scheduledAt: string;
  timezone: string;
  grandTotal: string;
  currency: string;
  createdAt: string;
  patientName: string;
  facility: { id: string; displayName: string } | null;
  itemCount: number;
  itemNames: string[];
  durationMinutes: number;
};

export type OrderPage = { items: OrderRow[]; page: number; limit: number; total: number; counts: Record<string, number> };

export type OrderItem = { id: string; offeringId: string; nameSnapshot: string; priceSnapshot: string; durationMinutes: number; modeSnapshot: FulfillmentMode; quantity: number; status: string; notPerformedReason: string | null };

export type Assignment = { id: string; orderItemId: string | null; assignedAt: string; assignedBy: { id: string; name: string }; practitioner: { id: string; fullName: string; practitionerType: { name: string } } };

export type OrderDetail = {
  version: number;
  id: string;
  code: string;
  status: string;
  assignmentStatus: string;
  paymentStatus: string;
  mode: FulfillmentMode;
  scheduledAt: string;
  timezone: string;
  currency: string;
  itemSubtotal: string;
  feeTotal: string;
  grandTotal: string;
  rejectionReason: string | null;
  slotId: string | null;
  facilityId: string;
  createdAt: string;
  durationMinutes: number;
  facility: { id: string; displayName: string } | null;
  facilitySnapshot: { displayName: string; addressLine: string; phone: string | null } | null;
  patient: { name: string; phone: string | null; sex: string | null; birthYear: number | null };
  address: { line: string; postalCode?: string | null; note?: string | null } | null;
  items: OrderItem[];
  assignments: Assignment[];
  history: Array<{ id: string; previousStatus: string | null; newStatus: string; reason: string | null; createdAt: string; actor: { id: string; name: string } | null }>;
};

export type AssignablePractitioner = { id: string; fullName: string; practitionerType: { name: string }; conflict: { orderCode: string; scheduledAt: string } | null };

export const SEX_LABELS: Record<string, string> = { FEMALE: 'Perempuan', MALE: 'Laki-laki' };
