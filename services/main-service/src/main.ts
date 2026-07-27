import 'reflect-metadata';
import path from 'path';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { EnvironmentService } from './common/runtime/environment';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: process.env.NODE_ENV === 'production' ? ['error', 'warn', 'log'] : undefined,
  });
  const port = Number(process.env.PORT || 3000);
  app.get(EnvironmentService).assertProductionReady();

  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  app.set('trust proxy', 1);
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new ResponseInterceptor());
  if (process.env.NODE_ENV !== 'production') {
    app.useStaticAssets(path.resolve(process.env.LOCAL_STORAGE_ROOT || path.resolve(__dirname, '../../../.local-storage'), 'home-rehab-motion-assets'), {
      prefix: '/oss-assets/',
    });
  }
  app.useStaticAssets(path.resolve(__dirname, '../assets/guidance-defaults-png'), {
    prefix: '/guidance-defaults/',
  });

  await app.listen(port);
  new Logger('Bootstrap').log(`home-rehab-motion main-service listening on ${port}`);
}

bootstrap();
