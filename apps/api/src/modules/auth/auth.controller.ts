import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { Public } from '../../common/access/access.decorators';
import type { AuthenticatedRequest } from '../../common/access/auth-context';
import { SameOriginGuard } from '../../common/access/same-origin.guard';
import { auditSource } from '../audit/audit.service';
import { AccountTokensService } from './account-tokens.service';
import { AuthService, type IssuedSession } from './auth.service';
import { AcceptInvitationDto, AccessTokenResponse, ForgotPasswordDto, LoginDto, ResetPasswordDto } from './dto/auth.dto';
import { REFRESH_COOKIE, refreshCookieOptions } from './tokens';

/**
 * The access token is returned in the body and kept in browser memory; the refresh token only ever travels
 * as an HTTP-only, SameSite=Strict cookie scoped to /api/v1/auth (spec §10).
 */
@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly accountTokens: AccountTokensService,
    private readonly config: ConfigService,
  ) {}

  @Post('login')
  @Public()
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiOkResponse({ type: AccessTokenResponse })
  async login(@Body() body: LoginDto, @Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: Response): Promise<AccessTokenResponse> {
    return this.respond(response, await this.auth.login(body.email, body.password, auditSource(request, 'PUBLIC')));
  }

  @Post('refresh')
  @Public()
  @UseGuards(SameOriginGuard)
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOkResponse({ type: AccessTokenResponse })
  async refresh(@Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: Response): Promise<AccessTokenResponse> {
    try {
      return this.respond(response, await this.auth.refresh(request.cookies?.[REFRESH_COOKIE], auditSource(request, 'PUBLIC')));
    } catch (error) {
      this.clearCookie(response);
      throw error;
    }
  }

  @Post('logout')
  @Public()
  @UseGuards(SameOriginGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: Response) {
    await this.auth.logout(request.cookies?.[REFRESH_COOKIE], auditSource(request, 'PUBLIC'));
    this.clearCookie(response);
  }

  @Post('forgot-password')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async forgotPassword(@Body() body: ForgotPasswordDto, @Req() request: AuthenticatedRequest) {
    await this.auth.forgotPassword(body.email, auditSource(request, 'PUBLIC'));
    return { message: 'If the email is registered, a reset link has been sent.' };
  }

  @Post('reset-password')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async resetPassword(@Body() body: ResetPasswordDto, @Req() request: AuthenticatedRequest) {
    await this.auth.resetPassword(body.token, body.password, auditSource(request, 'PUBLIC'));
  }

  /** Owner of an admin-created clinic sets their password from the one-time invitation link (spec §5.2). */
  @Post('accept-invitation')
  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async acceptInvitation(@Body() body: AcceptInvitationDto, @Req() request: AuthenticatedRequest) {
    await this.accountTokens.acceptInvitation(body.token, body.password, auditSource(request, 'PUBLIC'));
  }

  private respond(response: Response, session: IssuedSession): AccessTokenResponse {
    response.cookie(REFRESH_COOKIE, session.refreshToken, refreshCookieOptions(this.secureCookies(), session.refreshMaxAgeMs));
    return { accessToken: session.accessToken, expiresIn: session.expiresIn };
  }

  private clearCookie(response: Response) {
    const { maxAge: _maxAge, ...options } = refreshCookieOptions(this.secureCookies(), 0);
    response.clearCookie(REFRESH_COOKIE, options);
  }

  private secureCookies() {
    return this.config.get<boolean>('COOKIE_SECURE', false);
  }
}
