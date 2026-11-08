import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ActivityService } from '../common/activity.service';
import { fail } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { TermDto, UpdateTermDto } from './terms.dto';

/** 解析一行 CSV/TSV（支持双引号包裹与 "" 转义） */
export function parseLine(line: string): string[] {
  const sep = line.includes('\t') ? '\t' : ',';
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"' && cur === '') quoted = true;
    else if (ch === sep) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const uniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

@Injectable()
export class TermsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
  ) {}

  list(pid: string) {
    return this.prisma.term.findMany({
      where: { projectId: pid },
      orderBy: { term: 'asc' },
      include: { createdBy: { select: { id: true, username: true, displayName: true } } },
    });
  }

  async create(pid: string, userId: string, dto: TermDto) {
    try {
      return await this.prisma.term.create({ data: { projectId: pid, ...dto, term: dto.term.trim(), translation: dto.translation.trim(), createdById: userId } });
    } catch (e) {
      throw uniqueViolation(e) ? fail('TERM_EXISTS') : e;
    }
  }

  async update(pid: string, tid: string, dto: UpdateTermDto) {
    if (!(await this.prisma.term.findFirst({ where: { id: tid, projectId: pid } }))) throw fail('TERM_NOT_FOUND');
    try {
      return await this.prisma.term.update({ where: { id: tid }, data: dto });
    } catch (e) {
      throw uniqueViolation(e) ? fail('TERM_EXISTS') : e;
    }
  }

  remove(pid: string, tid: string) {
    return this.prisma.term.deleteMany({ where: { id: tid, projectId: pid } });
  }

  async import(pid: string, userId: string, text: string, overwrite = false) {
    const rows = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map(parseLine)
      .filter((cols) => cols[0] && cols[1]);
    if (!rows.length) throw fail('NO_TERMS_TO_IMPORT');
    let created = 0;
    let updated = 0;
    for (const [term, translation, note = ''] of rows) {
      const exist = await this.prisma.term.findUnique({ where: { projectId_term: { projectId: pid, term } } });
      if (!exist) {
        await this.prisma.term.create({ data: { projectId: pid, term, translation, note, createdById: userId } });
        created++;
      } else if (overwrite) {
        await this.prisma.term.update({ where: { id: exist.id }, data: { translation, note } });
        updated++;
      }
    }
    await this.activity.log(pid, userId, 'terms.import', { created, updated });
    return { created, updated, skipped: rows.length - created - updated };
  }
}
