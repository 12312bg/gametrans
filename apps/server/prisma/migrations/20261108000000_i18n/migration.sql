-- 多语言：用户界面语言、结构化的位置说明 / 动态 / 解析提示

ALTER TABLE "User" ADD COLUMN "locale" TEXT;

-- 原中文位置说明保留为搜索与显示兜底，结构化数据由后台任务从原文件补齐
ALTER TABLE "Entry" RENAME COLUMN "context" TO "contextSearch";
ALTER TABLE "Entry" ADD COLUMN "contextData" JSONB;

ALTER TABLE "Activity" ADD COLUMN "params" JSONB;
ALTER TABLE "Activity" ALTER COLUMN "message" SET DEFAULT '';

ALTER TABLE "File" ALTER COLUMN "warnings" DROP DEFAULT;
ALTER TABLE "File" ALTER COLUMN "warnings" TYPE JSONB USING to_jsonb("warnings");
ALTER TABLE "File" ALTER COLUMN "warnings" SET DEFAULT '[]';
ALTER TABLE "File" ALTER COLUMN "warnings" SET NOT NULL;
