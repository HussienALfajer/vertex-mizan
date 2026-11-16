import { Module } from '@nestjs/common';
import {
  MaterialsController,
  ProjectDocumentsController,
  ProjectTermsController,
  SubcontractsController,
} from './projects.controller.js';
import { ProjectsService } from './projects.service.js';

/** S12's projects: the materials catalogue, a project's terms, subcontracts, the documents' register. */
@Module({
  controllers: [
    MaterialsController,
    ProjectTermsController,
    SubcontractsController,
    ProjectDocumentsController,
  ],
  providers: [ProjectsService],
})
export class ProjectsModule {}
