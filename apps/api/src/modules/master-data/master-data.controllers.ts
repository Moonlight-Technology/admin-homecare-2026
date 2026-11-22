import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req, type Type } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Public, RequirePlatform } from '../../common/access/access.decorators';
import type { AuthenticatedRequest } from '../../common/access/auth-context';
import { AppError } from '../../common/errors/app-error';
import { PrismaService } from '../../prisma/prisma.service';
import { auditSource } from '../audit/audit.service';
import { PLATFORM_PERMISSIONS } from '../users-access/permissions.catalog';
import {
  CreateDocumentRequirementDto,
  CreateMasterServiceDto,
  CreateServiceCategoryDto,
  CreateTaxonomyDto,
  DocumentRequirementQueryDto,
  ImportRegionsDto,
  MasterListQueryDto,
  MasterServiceQueryDto,
  RegionQueryDto,
  UpdateDocumentRequirementDto,
  UpdateMasterServiceDto,
  UpdateServiceCategoryDto,
  UpdateTaxonomyDto,
} from './dto/master-data.dto';
import { MASTER_RESOURCES, MasterRecordsService, type MasterResource } from './master-records.service';
import { RegionsService } from './regions.service';

const READ = PLATFORM_PERMISSIONS.masterRead;
const WRITE = PLATFORM_PERMISSIONS.masterWrite;
const source = (request: AuthenticatedRequest) => auditSource(request, 'PLATFORM');

/** Same endpoints for each simple taxonomy; a fixed path per resource keeps routes explicit and documented. */
function taxonomyController(path: string, tag: string, resource: MasterResource): Type<unknown> {
  @ApiTags(`Master data: ${tag}`)
  @ApiBearerAuth()
  @Controller(`admin/master/${path}`)
  class TaxonomyController {
    constructor(readonly records: MasterRecordsService) {}

    @Get()
    @RequirePlatform(READ)
    list(@Query() query: MasterListQueryDto) {
      return this.records.list(resource, query);
    }

    @Get(':id')
    @RequirePlatform(READ)
    get(@Param('id', ParseUUIDPipe) id: string) {
      return this.records.get(resource, id);
    }

    @Post()
    @RequirePlatform(WRITE)
    create(@Body() body: CreateTaxonomyDto, @Req() request: AuthenticatedRequest) {
      return this.records.create(resource, { ...body }, source(request));
    }

    @Patch(':id')
    @RequirePlatform(WRITE)
    update(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateTaxonomyDto, @Req() request: AuthenticatedRequest) {
      return this.records.update(resource, id, { ...body }, source(request));
    }
  }
  Object.defineProperty(TaxonomyController, 'name', { value: `${tag.replace(/\W+/g, '')}Controller` });
  return TaxonomyController;
}

export const FacilityTypesController = taxonomyController('facility-types', 'Facility types', MASTER_RESOURCES.facilityTypes);
export const ClinicClassesController = taxonomyController('clinic-classes', 'Clinic classes', MASTER_RESOURCES.clinicClasses);
export const CapabilitiesController = taxonomyController('facility-capabilities', 'Facility capabilities', MASTER_RESOURCES.capabilities);
export const PractitionerTypesController = taxonomyController('practitioner-types', 'Practitioner types', MASTER_RESOURCES.practitionerTypes);

@ApiTags('Master data: Service categories')
@ApiBearerAuth()
@Controller('admin/master/service-categories')
export class ServiceCategoriesController {
  constructor(private readonly records: MasterRecordsService) {}

  @Get()
  @RequirePlatform(READ)
  list(@Query() query: MasterListQueryDto) {
    return this.records.list(MASTER_RESOURCES.serviceCategories, query);
  }

  @Get(':id')
  @RequirePlatform(READ)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.records.get(MASTER_RESOURCES.serviceCategories, id);
  }

  @Post()
  @RequirePlatform(WRITE)
  create(@Body() body: CreateServiceCategoryDto, @Req() request: AuthenticatedRequest) {
    return this.records.create(MASTER_RESOURCES.serviceCategories, { ...body }, source(request));
  }

  @Patch(':id')
  @RequirePlatform(WRITE)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateServiceCategoryDto, @Req() request: AuthenticatedRequest) {
    return this.records.update(MASTER_RESOURCES.serviceCategories, id, { ...body }, source(request));
  }
}

@ApiTags('Master data: Master services')
@ApiBearerAuth()
@Controller('admin/master/master-services')
export class MasterServicesController {
  constructor(
    private readonly records: MasterRecordsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  @RequirePlatform(READ)
  list(@Query() query: MasterServiceQueryDto) {
    return this.records.list(MASTER_RESOURCES.masterServices, query, query.categoryId ? { categoryId: query.categoryId } : {});
  }

  @Get(':id')
  @RequirePlatform(READ)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.records.get(MASTER_RESOURCES.masterServices, id);
  }

  @Post()
  @RequirePlatform(WRITE)
  async create(@Body() body: CreateMasterServiceDto, @Req() request: AuthenticatedRequest) {
    await this.assertCategory(body.categoryId);
    return this.records.create(MASTER_RESOURCES.masterServices, { ...body }, source(request));
  }

  @Patch(':id')
  @RequirePlatform(WRITE)
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateMasterServiceDto, @Req() request: AuthenticatedRequest) {
    if (body.categoryId) await this.assertCategory(body.categoryId);
    return this.records.update(MASTER_RESOURCES.masterServices, id, { ...body }, source(request));
  }

  /** A master service must sit in a live, active category. */
  private async assertCategory(categoryId: string) {
    const category = await this.prisma.serviceCategory.findFirst({ where: { id: categoryId, deletedAt: null }, select: { active: true } });
    if (!category) throw AppError.unprocessable('INVALID_REFERENCE', 'The category does not exist.', { fields: { categoryId: ['category not found'] } });
    if (!category.active) throw AppError.unprocessable('INVALID_REFERENCE', 'The category is inactive.', { fields: { categoryId: ['category is inactive'] } });
  }
}

@ApiTags('Master data: Document requirements')
@ApiBearerAuth()
@Controller('admin/master/document-requirements')
export class DocumentRequirementsController {
  constructor(private readonly records: MasterRecordsService) {}

  @Get()
  @RequirePlatform(READ)
  list(@Query() query: DocumentRequirementQueryDto) {
    return this.records.list(MASTER_RESOURCES.documentRequirements, query, query.ownerType ? { ownerType: query.ownerType } : {});
  }

  @Get(':id')
  @RequirePlatform(READ)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.records.get(MASTER_RESOURCES.documentRequirements, id);
  }

  @Post()
  @RequirePlatform(WRITE)
  create(@Body() body: CreateDocumentRequirementDto, @Req() request: AuthenticatedRequest) {
    return this.records.create(MASTER_RESOURCES.documentRequirements, { ...body }, source(request));
  }

  @Patch(':id')
  @RequirePlatform(WRITE)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateDocumentRequirementDto, @Req() request: AuthenticatedRequest) {
    return this.records.update(MASTER_RESOURCES.documentRequirements, id, { ...body }, source(request));
  }
}

/**
 * Active choices for clinic forms (registration is public, so this endpoint is too). Only names and ids of
 * active, non-deleted records: nothing beyond what the public catalogue will show anyway.
 */
@ApiTags('Public: Master options')
@Controller('public/master-options')
export class PublicMasterOptionsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @Public()
  async options() {
    const live = { where: { active: true, deletedAt: null }, orderBy: [{ sortOrder: 'asc' as const }, { name: 'asc' as const }], select: { id: true, code: true, name: true } };
    const [facilityTypes, clinicClasses, capabilities, practitionerTypes] = await Promise.all([
      this.prisma.facilityType.findMany(live),
      this.prisma.clinicClass.findMany(live),
      this.prisma.capability.findMany(live),
      this.prisma.practitionerType.findMany(live),
    ]);
    return { facilityTypes, clinicClasses, capabilities, practitionerTypes };
  }
}

@ApiTags('Master data: Regions')
@ApiBearerAuth()
@Controller('admin/master/regions')
export class RegionsController {
  constructor(private readonly regions: RegionsService) {}

  @Get()
  @RequirePlatform(READ)
  list(@Query() query: RegionQueryDto) {
    return this.regions.list(query);
  }

  @Post('import')
  @RequirePlatform(WRITE)
  @HttpCode(HttpStatus.OK)
  import(@Body() body: ImportRegionsDto, @Req() request: AuthenticatedRequest) {
    return this.regions.import(body.rows, source(request));
  }
}
