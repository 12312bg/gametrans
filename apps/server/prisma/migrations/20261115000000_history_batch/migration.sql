-- 批量操作的历史记录共用 batchId，历史记录页合并显示
ALTER TABLE "EntryHistory" ADD COLUMN "batchId" TEXT;
ALTER TABLE "TermHistory" ADD COLUMN "batchId" TEXT;
CREATE INDEX "EntryHistory_batchId_idx" ON "EntryHistory"("batchId");
CREATE INDEX "TermHistory_batchId_idx" ON "TermHistory"("batchId");

-- 旧数据：同一用户在同一秒内的同类批量记录视为一次操作
UPDATE "EntryHistory"
SET "batchId" = 'legacy_' || md5("projectId" || '|' || coalesce("userId", '') || '|' || action || '|' ||
  CASE WHEN action = 'SOURCE_CHANGED' THEN '' ELSE note END || '|' || date_trunc('second', "createdAt")::text)
WHERE action IN ('BATCH', 'REPLACE', 'TM_FILL', 'SYNC', 'SOURCE_CHANGED');

UPDATE "TermHistory"
SET "batchId" = 'legacy_' || md5("projectId" || '|' || coalesce("userId", '') || '|' || date_trunc('second', "createdAt")::text)
WHERE action = 'IMPORT';
