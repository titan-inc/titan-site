import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { createApplicationSchema, type ApplyResult, type CreateApplication } from '@titan/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { ApplicationsService } from './applications.service';

@Controller('applications')
@UseGuards(ThrottlerGuard)
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  @Post()
  @Throttle({ default: { limit: 5, ttl: 60 * 60 * 1_000 } })
  apply(
    @Body(new ZodValidationPipe(createApplicationSchema)) application: CreateApplication,
  ): Promise<ApplyResult> {
    return this.applications.apply(application);
  }
}
