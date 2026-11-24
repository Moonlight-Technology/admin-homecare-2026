import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';

@Module({ controllers: [UsersController, StaffController], providers: [UsersService, StaffService] })
export class UsersModule {}
