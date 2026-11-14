-- 词条在事件指令中所在的分支路径；旧数据为空，重新提取后补齐
ALTER TABLE "Entry" ADD COLUMN "branch" JSONB;
