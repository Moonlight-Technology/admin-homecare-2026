/** Shapes returned by the practitioner and affiliation API (S3). Credential numbers only ever arrive masked. */
import type { Review } from '@/features/facilities/types';

export type CredentialType = 'STR' | 'SIP';

export type Credential = {
  id: string;
  credentialType: CredentialType;
  numberMasked: string;
  issuingAuthority: string | null;
  validFrom: string | null;
  validUntil: string | null;
  reviewStatus: string;
  createdAt: string;
};

export type CredentialSummary = { credentialType: CredentialType; numberMasked: string; validUntil: string | null };

export type PractitionerRow = {
  id: string;
  fullName: string;
  verificationStatus: string;
  operatingStatus: string;
  registeredVia: 'ADMIN' | 'CLINIC';
  createdAt: string;
  updatedAt: string;
  practitionerType: { id: string; name: string };
  credentials: CredentialSummary[];
  activeAffiliations: number;
};

export type PractitionerAffiliationSummary = {
  id: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  note: string | null;
  reason: string | null;
  reviewedAt: string | null;
  createdAt: string;
  facility: { id: string; displayName: string };
};

export type PractitionerDetail = {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  verificationStatus: string;
  operatingStatus: string;
  verifiedAt: string | null;
  statusReason: string | null;
  registeredVia: 'ADMIN' | 'CLINIC';
  createdAt: string;
  practitionerType: { id: string; code: string; name: string };
  credentials: Credential[];
  affiliations: PractitionerAffiliationSummary[];
  registeredByFacility: { id: string; displayName: string } | null;
  missing: Record<string, string[]>;
  canSubmit: boolean;
  history: Review[];
};

export type Affiliation = {
  id: string;
  status: string;
  startDate: string | null;
  endDate: string | null;
  note: string | null;
  reason: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
  facility: { id: string; displayName: string; verificationStatus: string; operatingStatus: string };
  practitioner: { id: string; fullName: string; verificationStatus: string; operatingStatus: string; practitionerType: { id: string; name: string }; credentials: CredentialSummary[] };
};

export type Paged<T> = { items: T[]; page: number; limit: number; total: number; counts: Record<string, number> };

export type CredentialValues = { credentialType: CredentialType; number: string; issuingAuthority: string; validFrom: string; validUntil: string };
export type PractitionerValues = { fullName: string; practitionerTypeId: string; phone: string; email: string; credentials: CredentialValues[] };

export const emptyCredential = (credentialType: CredentialType = 'STR', number = ''): CredentialValues => ({ credentialType, number, issuingAuthority: '', validFrom: '', validUntil: '' });
export const emptyPractitioner = (strNumber = ''): PractitionerValues => ({ fullName: '', practitionerTypeId: '', phone: '', email: '', credentials: [emptyCredential('STR', strNumber)] });

/** Empty optional fields go to the API as null. */
export const credentialPayload = (values: CredentialValues) => ({
  credentialType: values.credentialType,
  number: values.number.trim(),
  issuingAuthority: values.issuingAuthority.trim() || null,
  validFrom: values.validFrom || null,
  validUntil: values.validUntil || null,
});

export const practitionerPayload = (values: PractitionerValues) => ({
  fullName: values.fullName.trim(),
  practitionerTypeId: values.practitionerTypeId,
  phone: values.phone.trim() || null,
  email: values.email.trim() || null,
  credentials: values.credentials.map(credentialPayload),
});

export const CREDENTIAL_LABELS: Record<CredentialType, string> = { STR: 'STR', SIP: 'SIP' };

/** "STR ••••5678 · berlaku s.d. ..." for compact lists. */
export const primaryCredential = (credentials: CredentialSummary[]) => credentials.find((credential) => credential.credentialType === 'STR') ?? credentials[0] ?? null;
