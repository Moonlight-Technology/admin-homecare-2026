import { Module } from '@nestjs/common';
import {
  CapabilitiesController,
  ClinicClassesController,
  DocumentRequirementsController,
  FacilityTypesController,
  MasterServicesController,
  PractitionerTypesController,
  PublicMasterOptionsController,
  RegionsController,
  ServiceCategoriesController,
} from './master-data.controllers';
import { MasterRecordsService } from './master-records.service';
import { RegionsService } from './regions.service';

@Module({
  controllers: [
    FacilityTypesController,
    ClinicClassesController,
    CapabilitiesController,
    PractitionerTypesController,
    ServiceCategoriesController,
    MasterServicesController,
    DocumentRequirementsController,
    RegionsController,
    PublicMasterOptionsController,
  ],
  providers: [MasterRecordsService, RegionsService],
  exports: [MasterRecordsService],
})
export class MasterDataModule {}
