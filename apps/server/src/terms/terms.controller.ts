import { BadRequestException, Body, ConflictException, Controller, Delete, Get, NotFoundException, Param, Patch, Post } from '@nestjs/common';
import { PERMISSIONS } from '@gametrans/shared';
import { Prisma } from '@prisma/client';
import { IsBoolean, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AccessService } from '../common/access.service';
import { ActivityService } from '../common/activity.service';
import { AuthUser, CurrentUser, Public } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';

class TermDto {
  @IsString() @Length(1, 200, { message: '术语长度为 1-200 个字符' }) term: string;
  @IsString() @Length(1, 500, { message: '译法长度为 1-500 个字符' }) translation: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @IsOptional() @IsBoolean() caseSensitive?: boolean;
}

class UpdateTermDto {
  @IsOptional() @IsString() @Length(1, 200) term?: string;
  @IsOptional() @IsString() @Length(1, 500) translation?: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @IsOptional() @IsBoolean() caseSensitive?: boolean;
}

class ImportDto {
  /** 每行「术语<Tab或逗号>译法[<Tab或逗号>备注]」 */
  @IsString() @MaxLength(2_000_000) text: string;
  @IsOptional() @IsBoolean() overwrite?: boolean;
}

/** 解析一行 CSV/TSV（支持双引号包裹） */
function parseLine(line: string): string[] {
  const sep = line.includes('\t') ? '\t' : ',';
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"' && cur === '') quoted = true;
    else if (c === sep) {
      out.push(cur);
      cur = '';
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

@ApiTags('术语表')
@Controller('projects/:pid/terms')
export class TermsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly activity: ActivityService,
  ) {}

  @ApiOperation({ summary: '术语列表' })
  @Public()
  @Get()
  async list(@CurrentUser() user: AuthUser | undefined, @Param('pid') pid: string) {
    await this.access.require(user, pid, PERMISSIONS.VIEW);
    return this.prisma.term.findMany({
      where: { projectId: pid },
      orderBy: { term: 'asc' },
      include: { createdBy: { select: { id: true, username: true, displayName: true } } },
    });
  }

  @ApiOperation({ summary: '添加术语', description: '需要审核员及以上。' })
  @Post()
  async create(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Body() dto: TermDto) {
    await this.access.require(user, pid, PERMISSIONS.MANAGE_TERMS);
    try {
      return await this.prisma.term.create({
        data: { projectId: pid, ...dto, term: dto.term.trim(), translation: dto.translation.trim(), createdById: user.id },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('该术语已存在');
      throw e;
    }
  }

  @ApiOperation({ summary: '修改术语' })
  @Patch(':tid')
  async update(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Param('tid') tid: string, @Body() dto: UpdateTermDto) {
    await this.access.require(user, pid, PERMISSIONS.MANAGE_TERMS);
    const t = await this.prisma.term.findFirst({ where: { id: tid, projectId: pid } });
    if (!t) throw new NotFoundException('术语不存在');
    try {
      return await this.prisma.term.update({ where: { id: tid }, data: dto });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new ConflictException('该术语已存在');
      throw e;
    }
  }

  @ApiOperation({ summary: '删除术语' })
  @Delete(':tid')
  async remove(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Param('tid') tid: string) {
    await this.access.require(user, pid, PERMISSIONS.MANAGE_TERMS);
    await this.prisma.term.deleteMany({ where: { id: tid, projectId: pid } });
    return { ok: true };
  }

  @ApiOperation({ summary: '批量导入术语', description: '每行「术语,译法[,备注]」，也支持 Tab 分隔。' })
  @Post('import')
  async import(@CurrentUser() user: AuthUser, @Param('pid') pid: string, @Body() dto: ImportDto) {
    await this.access.require(user, pid, PERMISSIONS.MANAGE_TERMS);
    const rows = dto.text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map(parseLine)
      .filter((cols) => cols[0] && cols[1]);
    if (!rows.length) throw new BadRequestException('没有可导入的术语（每行格式：术语,译法[,备注]）');
    let created = 0;
    let updated = 0;
    for (const [term, translation, note = ''] of rows) {
      const exist = await this.prisma.term.findUnique({ where: { projectId_term: { projectId: pid, term } } });
      if (exist) {
        if (dto.overwrite) {
          await this.prisma.term.update({ where: { id: exist.id }, data: { translation, note } });
          updated++;
        }
      } else {
        await this.prisma.term.create({ data: { projectId: pid, term, translation, note, createdById: user.id } });
        created++;
      }
    }
    await this.activity.log(pid, user.id, 'terms.import', `导入术语：新增 ${created} 条，更新 ${updated} 条`);
    return { created, updated, skipped: rows.length - created - updated };
  }
}
