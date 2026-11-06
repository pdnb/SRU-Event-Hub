import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthUser } from '../auth/auth.types';
import { CurrentUser, ReqMeta, RequestMeta, RequirePermissions } from '../common/decorators';
import {
  AvailabilityQueryDto,
  BookingQueryDto,
  BuildingDto,
  CatalogQueryDto,
  DecisionDto,
  RejectDto,
  ResourceBookingDto,
  ResourceDto,
  VenueBookingDto,
  VenueDto,
} from './venues.dto';
import { VenuesService } from './venues.service';

@ApiTags('venues')
@Controller()
export class VenuesController {
  constructor(private readonly venues: VenuesService) {}

  // ── catalogue ──
  @RequirePermissions('venue:view')
  @Get('buildings')
  buildings() {
    return this.venues.buildings();
  }

  @Post('buildings')
  createBuilding(@Body() dto: BuildingDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.venues.saveBuilding(null, dto, u, m);
  }

  @Patch('buildings/:id')
  updateBuilding(@Param('id', ParseUUIDPipe) id: string, @Body() dto: BuildingDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.venues.saveBuilding(id, dto, u, m);
  }

  @RequirePermissions('venue:view')
  @Get('venues')
  list(@Query() q: CatalogQueryDto) {
    return this.venues.venues(q);
  }

  @RequirePermissions('venue:view')
  @ApiOperation({ summary: 'สถานที่ว่าง/ไม่ว่างในช่วงเวลา (รวมคำขอที่รอพิจารณา)' })
  @Get('venues/availability')
  availability(@Query() q: AvailabilityQueryDto) {
    return this.venues.availability(q);
  }

  @RequirePermissions('venue:view')
  @Get('venues/:id')
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.venues.venue(id);
  }

  @Post('venues')
  create(@Body() dto: VenueDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.venues.saveVenue(null, dto, u, m);
  }

  @Patch('venues/:id')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: VenueDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.venues.saveVenue(id, dto, u, m);
  }

  @RequirePermissions('venue:view')
  @Get('resources')
  resources(@Query() q: CatalogQueryDto) {
    return this.venues.resources(q);
  }

  @RequirePermissions('venue:view')
  @Get('resources/:id/availability')
  resourceAvailability(@Param('id', ParseUUIDPipe) id: string, @Query() q: AvailabilityQueryDto) {
    return this.venues.resourceAvailability(id, q.from, q.to);
  }

  @Post('resources')
  createResource(@Body() dto: ResourceDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.venues.saveResource(null, dto, u, m);
  }

  @Patch('resources/:id')
  updateResource(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ResourceDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.venues.saveResource(id, dto, u, m);
  }

  // ── venue bookings (permission checks in the service: event scope / venue:view / venue:approve) ──
  @Get('venue-bookings')
  bookings(@Query() q: BookingQueryDto, @CurrentUser() u: AuthUser) {
    return this.venues.bookings(q, u);
  }

  @Post('venue-bookings')
  request(@Body() dto: VenueBookingDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.venues.requestVenue(dto, u, m);
  }

  @Post('venue-bookings/:id/approve')
  @HttpCode(200)
  approve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.venues.decideVenue(id, 'APPROVE', dto.note, u, m);
  }

  @Post('venue-bookings/:id/reject')
  @HttpCode(200)
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.venues.decideVenue(id, 'REJECT', dto.note, u, m);
  }

  @Post('venue-bookings/:id/cancel')
  @HttpCode(200)
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.venues.cancelVenue(id, dto.note, u, m);
  }

  // ── equipment bookings ──
  @Get('resource-bookings')
  resourceBookings(@Query() q: BookingQueryDto, @CurrentUser() u: AuthUser) {
    return this.venues.resourceBookings(q, u);
  }

  @Post('resource-bookings')
  requestResource(@Body() dto: ResourceBookingDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.venues.requestResource(dto, u, m);
  }

  @Post('resource-bookings/:id/approve')
  @HttpCode(200)
  approveResource(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.venues.decideResource(id, 'APPROVE', dto.note, u, m);
  }

  @Post('resource-bookings/:id/reject')
  @HttpCode(200)
  rejectResource(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RejectDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.venues.decideResource(id, 'REJECT', dto.note, u, m);
  }

  @Post('resource-bookings/:id/cancel')
  @HttpCode(200)
  cancelResource(@Param('id', ParseUUIDPipe) id: string, @Body() dto: DecisionDto, @CurrentUser() u: AuthUser, @ReqMeta() m: RequestMeta) {
    return this.venues.cancelResource(id, dto.note, u, m);
  }
}
