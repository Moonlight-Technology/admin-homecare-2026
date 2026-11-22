import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { PASSWORD_MIN_LENGTH } from '../password.service';

const normaliseEmail = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);

export class LoginDto {
  @ApiProperty({ example: 'admin@nakes.local' })
  @Transform(normaliseEmail)
  @IsEmail()
  @MaxLength(254)
  email: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  password: string;
}

export class ForgotPasswordDto {
  @ApiProperty()
  @Transform(normaliseEmail)
  @IsEmail()
  @MaxLength(254)
  email: string;
}

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(20)
  @MaxLength(200)
  token: string;

  @ApiProperty({ minLength: PASSWORD_MIN_LENGTH })
  @IsString()
  @MinLength(PASSWORD_MIN_LENGTH)
  @MaxLength(200)
  password: string;
}

export class AcceptInvitationDto {
  @ApiProperty() @IsString() @MinLength(20) @MaxLength(200) token: string;
  @ApiProperty({ minLength: PASSWORD_MIN_LENGTH }) @IsString() @MinLength(PASSWORD_MIN_LENGTH) @MaxLength(200) password: string;
}

export class AccessTokenResponse {
  @ApiProperty() accessToken: string;
  @ApiProperty({ description: 'Seconds until the access token expires.' }) expiresIn: number;
}
