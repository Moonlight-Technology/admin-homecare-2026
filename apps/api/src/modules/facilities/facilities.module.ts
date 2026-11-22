import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { AdminFacilitiesController, AdminFacilityApplicationsController, ClinicFacilityController, ClinicRegistrationController } from './facilities.controllers';
import { FacilitiesService } from './facilities.service';
import { VerificationService } from './verification.service';

@Module({
  imports: [DocumentsModule],
  controllers: [ClinicRegistrationController, AdminFacilitiesController, AdminFacilityApplicationsController, ClinicFacilityController],
  providers: [FacilitiesService, VerificationService],
  exports: [FacilitiesService],
})
export class FacilitiesModule {}
