import { Module } from '@nestjs/common';
import { AvailabilityModule } from '../availability/availability.module';
import { BookingKeyGuard } from './booking-key.guard';
import { BookingsService } from './bookings.service';
import { AdminOrdersController, BookingsController, ClinicOrdersController } from './orders.controllers';
import { OrdersService } from './orders.service';

@Module({
  imports: [AvailabilityModule],
  controllers: [BookingsController, ClinicOrdersController, AdminOrdersController],
  providers: [BookingsService, OrdersService, BookingKeyGuard],
})
export class OrdersModule {}
