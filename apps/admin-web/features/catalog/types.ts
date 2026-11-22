/** Shapes returned by the clinic catalog API (S4). Money arrives as exact decimal strings. */
export type FulfillmentMode = 'ON_SITE' | 'HOMECARE';
export const MODES: FulfillmentMode[] = ['ON_SITE', 'HOMECARE'];

export type OfferingMode = { id: string; mode: FulfillmentMode; enabled: boolean; priceOverride: string | null; visitFee: string | null };

export type Offering = {
  id: string;
  name: string;
  description: string | null;
  preparationNote: string | null;
  terms: string | null;
  basePrice: string;
  currency: string;
  durationMinutes: number;
  status: 'DRAFT' | 'PUBLISHED' | 'UNPUBLISHED' | 'ARCHIVED';
  publishedAt: string | null;
  updatedAt: string;
  masterServiceId: string;
  masterService: { id: string; code: string; name: string; active: boolean; category: { id: string; slug: string; name: string } };
  modes: OfferingMode[];
  publishBlockers: string[];
};

export type FacilityState = { verificationStatus: string; operatingStatus: string; providerStatus: string | null };
export type OfferingPage = { items: Offering[]; page: number; limit: number; total: number; counts: Record<string, number>; facility: FacilityState };

export type CatalogOptions = { categories: Array<{ id: string; slug: string; name: string; masterServices: Array<{ id: string; code: string; name: string; description: string | null }> }> };

export type ModeValues = { enabled: boolean; priceOverride: string; visitFee: string };
export type OfferingValues = {
  masterServiceId: string;
  name: string;
  description: string;
  preparationNote: string;
  terms: string;
  basePrice: string;
  durationMinutes: string;
  modes: Record<FulfillmentMode, ModeValues>;
};

export const emptyOffering = (): OfferingValues => ({
  masterServiceId: '',
  name: '',
  description: '',
  preparationNote: '',
  terms: '',
  basePrice: '',
  durationMinutes: '30',
  modes: { ON_SITE: { enabled: true, priceOverride: '', visitFee: '' }, HOMECARE: { enabled: false, priceOverride: '', visitFee: '' } },
});

/** Whole rupiah for editing ("150000.00" → "150000"). */
const rupiah = (value: string | null) => (value ? String(Math.round(Number(value))) : '');

export const offeringValues = (offering: Offering): OfferingValues => {
  const mode = (name: FulfillmentMode): ModeValues => {
    const entry = offering.modes.find((item) => item.mode === name);
    return { enabled: Boolean(entry?.enabled), priceOverride: rupiah(entry?.priceOverride ?? null), visitFee: rupiah(entry?.visitFee ?? null) };
  };
  return {
    masterServiceId: offering.masterServiceId,
    name: offering.name,
    description: offering.description ?? '',
    preparationNote: offering.preparationNote ?? '',
    terms: offering.terms ?? '',
    basePrice: rupiah(offering.basePrice),
    durationMinutes: String(offering.durationMinutes),
    modes: { ON_SITE: mode('ON_SITE'), HOMECARE: mode('HOMECARE') },
  };
};

/** Both modes are always sent in MODES order, so `modes.0` is on-site and `modes.1` homecare in field errors. */
export const offeringPayload = (values: OfferingValues, includeMasterService: boolean) => ({
  ...(includeMasterService ? { masterServiceId: values.masterServiceId } : {}),
  name: values.name.trim(),
  description: values.description.trim() || null,
  preparationNote: values.preparationNote.trim() || null,
  terms: values.terms.trim() || null,
  basePrice: values.basePrice,
  durationMinutes: Number(values.durationMinutes),
  modes: MODES.map((mode) => ({
    mode,
    enabled: values.modes[mode].enabled,
    priceOverride: values.modes[mode].priceOverride || null,
    ...(mode === 'HOMECARE' ? { visitFee: values.modes[mode].visitFee || null } : {}),
  })),
});

export const MODE_DESCRIPTIONS: Record<FulfillmentMode, string> = {
  ON_SITE: 'Pasien datang ke klinik; alamat mengikuti profil klinik.',
  HOMECARE: 'Nakes berkunjung ke rumah pasien.',
};

export const BLOCKER_LABELS: Record<string, string> = {
  FACILITY_NOT_VERIFIED: 'Klinik belum terverifikasi.',
  FACILITY_NOT_ACTIVE: 'Klinik tidak aktif (disuspend atau belum diaktifkan).',
  MASTER_SERVICE_INACTIVE: 'Layanan master sudah tidak tersedia.',
  NO_ENABLED_MODE: 'Aktifkan minimal satu mode layanan.',
  INCOMPLETE: 'Lengkapi nama, harga, dan durasi.',
};
