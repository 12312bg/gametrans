-- 术语表修改记录
CREATE TABLE "TermHistory" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TermHistory_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TermHistory_projectId_createdAt_idx" ON "TermHistory"("projectId", "createdAt");
CREATE INDEX "TermHistory_projectId_userId_idx" ON "TermHistory"("projectId", "userId");

ALTER TABLE "TermHistory" ADD CONSTRAINT "TermHistory_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TermHistory" ADD CONSTRAINT "TermHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
