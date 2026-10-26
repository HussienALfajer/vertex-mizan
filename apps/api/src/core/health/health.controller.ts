import {
  Controller,
  Get,
  Inject,
  SerializeOptions,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiOkResponse, ApiServiceUnavailableResponse, ApiTags } from '@nestjs/swagger';
import { type HealthResponse, healthResponseSchema } from '@vertex-mizan/contracts';
import { Public } from '../access/access.js';
import { HealthService } from './health.service.js';

/** For the load balancer and the deployment's start check: no session, no company data. */
@ApiTags('system')
@Controller('health')
export class HealthController {
  constructor(@Inject(HealthService) private readonly health: HealthService) {}

  @Get()
  @Public()
  @SerializeOptions({ schema: healthResponseSchema })
  @ApiOkResponse({
    description: 'The API and its database answer',
    standardSchema: healthResponseSchema,
  })
  @ApiServiceUnavailableResponse({
    description: 'The database does not answer',
    standardSchema: healthResponseSchema,
  })
  async check(): Promise<HealthResponse> {
    const result = await this.health.check();
    if (result.status !== 'ok') throw new ServiceUnavailableException(result);
    return result;
  }
}
