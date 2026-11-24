import { Module } from '@nestjs/common';
import { TwineController } from './twine.controller';
import { TwineService } from './twine.service';

@Module({ controllers: [TwineController], providers: [TwineService] })
export class TwineModule {}
