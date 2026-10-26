import { Module } from '@nestjs/common';
import { CompaniesController, CompanyController } from './companies.controller.js';
import { CompaniesService } from './companies.service.js';

/** Companies, their ledger settings and archive (S01 rules 9–13). */
@Module({
  controllers: [CompaniesController, CompanyController],
  providers: [CompaniesService],
})
export class CompaniesModule {}
