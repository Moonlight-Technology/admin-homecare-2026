import { Module } from '@nestjs/common';
import { AffiliationsService } from './affiliations.service';
import { AdminAffiliationsController, AdminPractitionersController, ClinicPractitionersController } from './practitioners.controllers';
import { PractitionersService } from './practitioners.service';

@Module({
  controllers: [AdminPractitionersController, AdminAffiliationsController, ClinicPractitionersController],
  providers: [PractitionersService, AffiliationsService],
  exports: [PractitionersService, AffiliationsService],
})
export class PractitionersModule {}
