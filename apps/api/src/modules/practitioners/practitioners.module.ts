import { Module } from '@nestjs/common';
import { AffiliationsService } from './affiliations.service';
import { AdminAffiliationsController, AdminPractitionersController, ClinicPractitionersController } from './practitioners.controllers';
import { PractitionersService } from './practitioners.service';
import { DocumentsModule } from '../documents/documents.module';
import { AdminPractitionerDocumentsController, ClinicPractitionerDocumentsController } from './practitioner-documents.controllers';
import { PractitionerDocumentsService } from './practitioner-documents.service';

@Module({
  imports: [DocumentsModule],
  controllers: [AdminPractitionersController, AdminAffiliationsController, ClinicPractitionersController, AdminPractitionerDocumentsController, ClinicPractitionerDocumentsController],
  providers: [PractitionersService, AffiliationsService, PractitionerDocumentsService],
  exports: [PractitionersService, AffiliationsService],
})
export class PractitionersModule {}
