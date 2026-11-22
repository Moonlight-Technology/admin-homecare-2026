import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentFacility, RequireFacility, RequirePlatform } from '../../common/access/access.decorators';
import type { FacilityScope } from '../../common/access/auth-context';
import { FACILITY_PERMISSIONS, PLATFORM_PERMISSIONS } from '../users-access/permissions.catalog';
import { DashboardService } from './dashboard.service';

@ApiTags('Dashboard')
@ApiBearerAuth()
@Controller()
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get('admin/dashboard/summary')
  @RequirePlatform(PLATFORM_PERMISSIONS.dashboardRead)
  platform() {
    return this.dashboard.platformSummary();
  }

  @Get('clinic/dashboard/summary')
  @RequireFacility(FACILITY_PERMISSIONS.dashboardRead)
  clinic(@CurrentFacility() facility: FacilityScope) {
    return this.dashboard.clinicSummary(facility.facilityId);
  }
}
