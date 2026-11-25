-- Twine 项目改用自己的词条分类：正文（passage）、链接文字（link）、界面文字（ui）。
-- 按位置说明判断：正文行 → passage；单独一行的链接 → link；特殊段落（StoryCaption 等）中的 → ui；
-- 没有说话人的自定义宏参数（旧版本默认为对话）→ passage。重新提取后也会得到同样的结果。
UPDATE "Entry" AS e
SET "category" = CASE
    WHEN e."category" = 'system'
      OR (e."contextData"->0->'p'->>'name') IN ('StoryCaption', 'StoryMenu', 'StoryBanner', 'StorySubtitle', 'StoryAuthor', 'StoryShare', 'StoryInterface', 'PassageHeader', 'PassageFooter')
      THEN CASE WHEN e."category" IN ('script', 'speaker') THEN e."category" ELSE 'ui' END
    WHEN e."contextData"->1->>'k' = 'ctx.tw.text' THEN 'passage'
    WHEN e."contextData"->1->>'k' = 'ctx.tw.link' AND e."category" = 'choice' THEN 'link'
    WHEN e."contextData"->1->>'k' = 'ctx.tw.arg' AND e."category" = 'dialogue' THEN 'passage'
    ELSE e."category"
  END
FROM "Project" AS p
WHERE e."projectId" = p."id" AND p."engine" = 'TWINE';
