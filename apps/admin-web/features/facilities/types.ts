/** Shapes returned by the facility and verification API (S2). */
export type Option = { id: string; code: string; name: string };

export type Facility = {
  id: string;
  displayName: string;
  legalName: string;
  facilityTypeId: string;
  clinicClassId: string | null;
  phone: string | null;
  email: string | null;
  addressLine: string;
  regionCode: string | null;
  postalCode: string | null;
  latitude: number | null;
  longitude: number | null;
  timezone: string;
  verificationStatus: string;
  operatingStatus: string;
  verifiedAt: string | null;
  statusReason: string | null;
  registeredVia: 'SELF' | 'ADMIN';
  createdAt: string;
  facilityType: Option;
  clinicClass: Option | null;
  capabilities: Option[];
  owner: { id: string; name: string; email: string; status: string } | null;
};

export type ProfileValues = {
  displayName: string;
  legalName: string;
  facilityTypeId: string;
  clinicClassId: string;
  capabilityIds: string[];
  phone: string;
  email: string;
  addressLine: string;
  postalCode: string;
};

export type DocumentInfo = { id: string; requirementId: string | null; fileName: string; mimeType: string; sizeBytes: number; status: string; uploadedAt: string | null };

export type Requirement = { id: string; code: string; name: string; description: string | null; mandatory: boolean; document: (DocumentInfo & { url?: string; expiresAt?: string }) | null };

export type Review = { id: string; decision: 'APPROVE' | 'REJECT' | 'REQUEST_REVISION'; reason: string | null; reviewer: { id: string; name: string }; createdAt: string };

export type ApplicationVersion = { id: string; version: number; status: string; submittedAt: string; decidedAt: string | null; reviews: Review[] };

export type ClinicVerificationState = {
  facility: { id: string; displayName: string; verificationStatus: string; operatingStatus: string; statusReason: string | null; verifiedAt: string | null };
  requirements: Requirement[];
  missing: Record<string, string[]>;
  canSubmit: boolean;
  editable: boolean;
  history: ApplicationVersion[];
};

export type ApplicationDetail = {
  application: { id: string; version: number; status: string; submittedAt: string; decidedAt: string | null; submittedBy: { id: string; name: string; email: string } | null; profileSnapshot: Partial<Facility> };
  facility: Facility;
  checklist: Requirement[];
  history: ApplicationVersion[];
  isLatest: boolean;
};

export type ApplicationRow = {
  id: string;
  version: number;
  status: string;
  submittedAt: string;
  decidedAt: string | null;
  facility: { id: string; displayName: string; legalName: string; addressLine: string; verificationStatus: string; facilityType: { name: string }; clinicClass: { name: string } | null };
};

export const emptyProfile = (): ProfileValues => ({ displayName: '', legalName: '', facilityTypeId: '', clinicClassId: '', capabilityIds: [], phone: '', email: '', addressLine: '', postalCode: '' });

export const profileFromFacility = (facility: Facility): ProfileValues => ({
  displayName: facility.displayName,
  legalName: facility.legalName,
  facilityTypeId: facility.facilityTypeId,
  clinicClassId: facility.clinicClassId ?? '',
  capabilityIds: facility.capabilities.map((capability) => capability.id),
  phone: facility.phone ?? '',
  email: facility.email ?? '',
  addressLine: facility.addressLine,
  postalCode: facility.postalCode ?? '',
});

/** Empty optional fields go to the API as null so they can be cleared. */
export const profilePayload = (values: ProfileValues) => ({
  ...values,
  clinicClassId: values.clinicClassId || null,
  phone: values.phone.trim() || null,
  email: values.email.trim() || null,
  postalCode: values.postalCode.trim() || null,
});

export const DECISION_LABELS: Record<Review['decision'], string> = { APPROVE: 'Disetujui', REQUEST_REVISION: 'Perlu revisi', REJECT: 'Ditolak' };
