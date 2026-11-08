import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokensController } from './tokens.controller';
import { TokensService } from './tokens.service';

@Module({
  controllers: [AuthController, TokensController],
  providers: [AuthService, TokensService],
  exports: [AuthService, TokensService],
})
export class AuthModule {}
