import { type DynamicModule, Global, Module } from '@nestjs/common';
import type { Config } from './config.js';

/** Injection token for the worker's checked environment. */
export const CONFIG = Symbol('CONFIG');

@Global()
@Module({})
export class ConfigModule {
  static forRoot(config: Config): DynamicModule {
    return {
      module: ConfigModule,
      providers: [{ provide: CONFIG, useValue: config }],
      exports: [CONFIG],
    };
  }
}
