import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthContextService } from '../../common/access/auth-context.service';
import { SameOriginGuard } from '../../common/access/same-origin.guard';
import { AccountTokensService } from './account-tokens.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { MeController } from './me.controller';
import { PasswordService } from './password.service';

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        signOptions: { algorithm: 'HS256', issuer: 'nakes-api', audience: 'nakes-admin-web' },
        verifyOptions: { algorithms: ['HS256'], issuer: 'nakes-api', audience: 'nakes-admin-web' },
      }),
    }),
  ],
  controllers: [AuthController, MeController],
  providers: [AuthService, PasswordService, AuthContextService, SameOriginGuard, AccountTokensService],
  exports: [AuthContextService, PasswordService, AccountTokensService],
})
export class AuthModule {}
