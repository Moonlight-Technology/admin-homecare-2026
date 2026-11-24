import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RequirePlatform } from '../../common/access/access.decorators';
import type { AuthenticatedRequest } from '../../common/access/auth-context';
import { auditSource } from '../audit/audit.service';
import { PLATFORM_PERMISSIONS as P } from './permissions.catalog';
import { InvitePlatformUserDto, PlatformUserStatusDto, UpdatePlatformUserDto, UserQueryDto } from './users.dto';
import { UsersService } from './users.service';

@ApiTags('Admin: Users')
@Controller('admin/users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get() @RequirePlatform(P.platformUserRead)
  @ApiOperation({ summary: 'List platform users only; clinic owners/staff are managed separately.' })
  list(@Query() query: UserQueryDto) { return this.users.list(query); }

  @Post() @RequirePlatform(P.platformUserManage)
  @ApiOperation({ summary: 'Invite a new platform user; queues a one-time activation invitation.' })
  invite(@Body() body: InvitePlatformUserDto, @Req() request: AuthenticatedRequest) { return this.users.invite(body, auditSource(request, 'PLATFORM')); }

  @Get(':id') @RequirePlatform(P.platformUserRead)
  detail(@Param('id', ParseUUIDPipe) id: string) { return this.users.detail(id); }

  @Patch(':id') @RequirePlatform(P.platformUserManage)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() body: UpdatePlatformUserDto, @Req() request: AuthenticatedRequest) { return this.users.update(id, body, auditSource(request, 'PLATFORM')); }

  @Post(':id/status') @HttpCode(HttpStatus.OK) @RequirePlatform(P.platformUserManage)
  status(@Param('id', ParseUUIDPipe) id: string, @Body() body: PlatformUserStatusDto, @Req() request: AuthenticatedRequest) { return this.users.status(id, body, auditSource(request, 'PLATFORM')); }

  @Post(':id/resend-invitation') @HttpCode(HttpStatus.NO_CONTENT) @RequirePlatform(P.platformUserManage)
  async resend(@Param('id', ParseUUIDPipe) id: string, @Req() request: AuthenticatedRequest) { await this.users.resendInvitation(id, auditSource(request, 'PLATFORM')); }
}
