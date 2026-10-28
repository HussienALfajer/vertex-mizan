import { Module } from '@nestjs/common';
import { ExportsController } from './exports.controller.js';
import { ExportsService } from './exports.service.js';

/** The owner's full export of a company's data (S03 rule 21); the worker builds the file. */
@Module({ controllers: [ExportsController], providers: [ExportsService] })
export class ExportsModule {}
