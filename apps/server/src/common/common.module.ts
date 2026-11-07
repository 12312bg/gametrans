import { Global, Module } from '@nestjs/common';
import { AccessService } from './access.service';
import { ActivityService } from './activity.service';
import { StorageService } from './storage.service';

@Global()
@Module({
  providers: [AccessService, ActivityService, StorageService],
  exports: [AccessService, ActivityService, StorageService],
})
export class CommonModule {}
