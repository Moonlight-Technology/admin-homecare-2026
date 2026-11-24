import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentFacility, RequireFacility } from '../../common/access/access.decorators';
import type { AuthenticatedRequest, FacilityScope } from '../../common/access/auth-context';
import { auditSource } from '../audit/audit.service';
import { FACILITY_PERMISSIONS as P } from './permissions.catalog';
import { InviteStaffDto, StaffAccessDto, StaffQueryDto, UpdateStaffRoleDto } from './staff.dto';
import { StaffService } from './staff.service';

@ApiTags('Clinic: Staff')
@Controller('clinic/staff')
export class StaffController {
  constructor(private readonly staff: StaffService) {}

  @Get() @RequireFacility(P.staffRead)
  list(@CurrentFacility() scope: FacilityScope, @Query() query: StaffQueryDto) { return this.staff.list(scope, query); }

  @Get('roles') @RequireFacility(P.staffRead)
  @ApiOperation({ summary: 'Clinic role options and their existing seeded permissions; no global role edits.' })
  roles() { return this.staff.roles(); }

  @Post() @RequireFacility(P.staffManage)
  @ApiOperation({ summary: 'Create a new invited account with access only to the caller\'s clinic. Email delivery is deferred.' })
  invite(@CurrentFacility() scope: FacilityScope, @Body() body: InviteStaffDto, @Req() request: AuthenticatedRequest) { return this.staff.invite(scope, body, auditSource(request, 'FACILITY')); }

  @Get(':id') @RequireFacility(P.staffRead)
  @ApiOperation({ summary: 'Staff membership detail. id is a membership ID, not a user ID.' })
  detail(@CurrentFacility() scope: FacilityScope, @Param('id', ParseUUIDPipe) id: string) { return this.staff.detail(scope, id); }

  @Patch(':id') @RequireFacility(P.staffManage)
  update(@CurrentFacility() scope: FacilityScope, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateStaffRoleDto, @Req() request: AuthenticatedRequest) { return this.staff.updateRole(scope, id, body, auditSource(request, 'FACILITY')); }

  @Post(':id/access') @HttpCode(HttpStatus.OK) @RequireFacility(P.staffManage)
  access(@CurrentFacility() scope: FacilityScope, @Param('id', ParseUUIDPipe) id: string, @Body() body: StaffAccessDto, @Req() request: AuthenticatedRequest) { return this.staff.access(scope, id, body, auditSource(request, 'FACILITY')); }

  @Post(':id/resend-invitation') @HttpCode(HttpStatus.NO_CONTENT) @RequireFacility(P.staffManage)
  async resend(@CurrentFacility() scope: FacilityScope, @Param('id', ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest) { await this.staff.resend(scope, id, auditSource(request, 'FACILITY')); }
}
