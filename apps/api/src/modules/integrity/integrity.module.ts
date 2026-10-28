import { Module } from '@nestjs/common';
import { IntegrityController } from './integrity.controller.js';
import { IntegrityService } from './integrity.service.js';

/** The integrity check of a company's books (S03 rule 19). */
@Module({ controllers: [IntegrityController], providers: [IntegrityService] })
export class IntegrityModule {}
