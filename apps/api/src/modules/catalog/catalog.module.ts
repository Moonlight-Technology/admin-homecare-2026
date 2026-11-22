import { Module } from '@nestjs/common';
import { ClinicOfferingsController, PublicCatalogController } from './catalog.controllers';
import { OfferingsService } from './offerings.service';
import { PublicCatalogService } from './public-catalog.service';

@Module({
  controllers: [ClinicOfferingsController, PublicCatalogController],
  providers: [OfferingsService, PublicCatalogService],
  exports: [OfferingsService],
})
export class CatalogModule {}
