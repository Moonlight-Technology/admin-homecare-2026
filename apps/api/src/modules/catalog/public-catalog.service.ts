import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppError } from '../../common/errors/app-error';
import { paginate, skipTake } from '../../common/dto/pagination.dto';
import { PrismaService } from '../../prisma/prisma.service';
import type { PublicFacilityQueryDto, PublicOfferingQueryDto } from './dto/offering.dto';

/**
 * Only verified, active clinics with an active provider are public; a suspended clinic disappears with all its
 * offerings at once (spec §5.1 step 7, AC-FAC-05) without touching the offerings themselves.
 */
const PUBLIC_FACILITY: Prisma.FacilityWhereInput = { verificationStatus: 'VERIFIED', operatingStatus: 'ACTIVE', provider: { status: 'ACTIVE' } };

const liveOffering = (mode?: 'ON_SITE' | 'HOMECARE', categoryId?: string): Prisma.ServiceOfferingWhereInput => ({
  status: 'PUBLISHED',
  masterService: { active: true, deletedAt: null, ...(categoryId ? { categoryId } : {}) },
  modes: { some: { enabled: true, ...(mode ? { mode } : {}) } },
});

/** Public fields only: no owner, verification history, internal reasons, or documents. */
const publicFacilitySelect = {
  id: true,
  displayName: true,
  phone: true,
  addressLine: true,
  regionCode: true,
  postalCode: true,
  latitude: true,
  longitude: true,
  timezone: true,
  facilityType: { select: { id: true, code: true, name: true } },
  clinicClass: { select: { id: true, code: true, name: true } },
  capabilities: { select: { capability: { select: { id: true, code: true, name: true } } } },
} satisfies Prisma.FacilitySelect;

type PublicFacilityRow = Prisma.FacilityGetPayload<{ select: typeof publicFacilitySelect }>;

const presentFacility = ({ capabilities, latitude, longitude, ...facility }: PublicFacilityRow) => ({
  ...facility,
  latitude: latitude === null ? null : Number(latitude),
  longitude: longitude === null ? null : Number(longitude),
  capabilities: capabilities.map((entry) => entry.capability),
});

/** Customer-facing discovery contract (spec §8): the mobile app reads this; it never writes. */
@Injectable()
export class PublicCatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async facilities(query: PublicFacilityQueryDto) {
    const where: Prisma.FacilityWhereInput = {
      ...PUBLIC_FACILITY,
      ...(query.facilityTypeId ? { facilityTypeId: query.facilityTypeId } : {}),
      ...(query.clinicClassId ? { clinicClassId: query.clinicClassId } : {}),
      ...(query.capabilityId ? { capabilities: { some: { capabilityId: query.capabilityId } } } : {}),
      ...(query.regionCode ? { regionCode: { startsWith: query.regionCode } } : {}),
      // A clinic is listed once it has something to book, in the requested mode/category when given.
      provider: { status: 'ACTIVE', offerings: { some: liveOffering(query.mode, query.categoryId) } },
      ...(query.search ? { OR: [{ displayName: { contains: query.search, mode: 'insensitive' } }, { addressLine: { contains: query.search, mode: 'insensitive' } }, { provider: { offerings: { some: { ...liveOffering(query.mode), name: { contains: query.search, mode: 'insensitive' } } } } }] } : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.facility.findMany({
        where,
        orderBy: { displayName: query.sortOrder === 'desc' ? 'desc' : 'asc' },
        ...skipTake(query),
        select: { ...publicFacilitySelect, provider: { select: { offerings: { where: liveOffering(query.mode), select: { modes: { where: { enabled: true }, select: { mode: true } } } } } } },
      }),
      this.prisma.facility.count({ where }),
    ]);
    return paginate(items.map(({ provider, ...facility }) => {
      const offerings = provider?.offerings ?? [];
      return { ...presentFacility(facility), offeringCount: offerings.length, modes: [...new Set(offerings.flatMap((offering) => offering.modes.map((entry) => entry.mode)))].sort() };
    }), total, query);
  }

  async facility(id: string) {
    const facility = await this.prisma.facility.findFirst({ where: { id, ...PUBLIC_FACILITY }, select: publicFacilitySelect });
    if (!facility) throw AppError.notFound();
    return presentFacility(facility);
  }

  /** Published offerings with their bookable modes and the price that applies to each mode. */
  async offerings(facilityId: string, query: PublicOfferingQueryDto) {
    await this.facility(facilityId);
    const offerings = await this.prisma.serviceOffering.findMany({
      where: { provider: { facilityId }, ...liveOffering(query.mode) },
      orderBy: [{ masterService: { category: { sortOrder: 'asc' } } }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        description: true,
        preparationNote: true,
        terms: true,
        basePrice: true,
        currency: true,
        durationMinutes: true,
        masterService: { select: { id: true, code: true, name: true, category: { select: { id: true, slug: true, name: true } } } },
        modes: { where: { enabled: true, ...(query.mode ? { mode: query.mode } : {}) }, orderBy: { mode: 'asc' }, select: { mode: true, priceOverride: true, visitFee: true } },
      },
    });
    return {
      items: offerings.map(({ modes, ...offering }) => ({
        ...offering,
        modes: modes.map((mode) => ({ mode: mode.mode, price: (mode.priceOverride ?? offering.basePrice).toFixed(2), visitFee: mode.visitFee?.toFixed(2) ?? null })),
      })),
    };
  }
}
