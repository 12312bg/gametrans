-- 预编辑补丁改用 json 存储：jsonb 会重排对象键，导致补丁中的旧值与原文件对不上
ALTER TABLE "File" ALTER COLUMN "editPatch" SET DATA TYPE JSON;
