import { Module } from '@nestjs/common';
import { ClinicAvailabilityController, PublicSlotsController } from './availability.controllers';
import { AvailabilityService } from './availability.service';

@Module({
  controllers: [ClinicAvailabilityController, PublicSlotsController],
  providers: [AvailabilityService],
  exports: [AvailabilityService],
})
export class AvailabilityModule {}
