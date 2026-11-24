-- Twine（SugarCube）引擎；项目的解析配置（Twine 的自定义宏规则等）
ALTER TYPE "Engine" ADD VALUE 'TWINE';
ALTER TABLE "Project" ADD COLUMN "parserConfig" JSONB;
