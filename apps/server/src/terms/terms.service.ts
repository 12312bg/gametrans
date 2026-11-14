import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { ActivityService } from '../common/activity.service';
import { fail } from '../common/errors';
import { chunk } from '../common/query';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService, rtUser } from '../realtime/realtime.service';
import type { AuthUser } from '../common/decorators';
import type { TermHistoryAction, TermSnapshot } from '@gametrans/shared';
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

const snap = (t: TermSnapshot): Prisma.InputJsonObject => ({ term: t.term, translation: t.translation, note: t.note, caseSensitive: t.caseSensitive });

const uniqueViolation = (e: unknown) => e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';

@Injectable()
export class TermsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly activity: ActivityService,
    private readonly rt: RealtimeService,
  ) {}

  list(pid: string) {
    return this.prisma.term.findMany({
      where: { projectId: pid },
      orderBy: { term: 'asc' },
      include: { createdBy: { select: { id: true, username: true, displayName: true } } },
    });
  }

  private history(pid: string, userId: string, action: TermHistoryAction, termId: string, before: TermSnapshot | null, after: TermSnapshot | null) {
    return {
      projectId: pid,
      termId,
      userId,
      action,
      term: (after ?? before)!.term,
      before: before ? snap(before) : Prisma.DbNull,
      after: after ? snap(after) : Prisma.DbNull,
    } satisfies Prisma.TermHistoryUncheckedCreateInput;
  }

  private changed(pid: string, user: AuthUser) {
    this.rt.publish(pid, { type: 'terms', by: rtUser(user) });
  }

  async create(pid: string, user: AuthUser, dto: TermDto) {
    let created;
    try {
      created = await this.prisma.term.create({ data: { projectId: pid, ...dto, term: dto.term.trim(), translation: dto.translation.trim(), createdById: user.id } });
    } catch (e) {
      throw uniqueViolation(e) ? fail('TERM_EXISTS') : e;
    }
    await this.prisma.termHistory.create({ data: this.history(pid, user.id, 'CREATE', created.id, null, created) });
    this.changed(pid, user);
    return created;
  }

  async update(pid: string, user: AuthUser, tid: string, dto: UpdateTermDto) {
    const before = await this.prisma.term.findFirst({ where: { id: tid, projectId: pid } });
    if (!before) throw fail('TERM_NOT_FOUND');
    let after;
    try {
      after = await this.prisma.term.update({ where: { id: tid }, data: dto });
    } catch (e) {
      throw uniqueViolation(e) ? fail('TERM_EXISTS') : e;
    }
    if (JSON.stringify(snap(before)) !== JSON.stringify(snap(after))) {
      await this.prisma.termHistory.create({ data: this.history(pid, user.id, 'UPDATE', tid, before, after) });
      this.changed(pid, user);
    }
    return after;
  }

  async remove(pid: string, user: AuthUser, tid: string) {
    const before = await this.prisma.term.findFirst({ where: { id: tid, projectId: pid } });
    if (!before) return;
    await this.prisma.$transaction([
      this.prisma.term.delete({ where: { id: tid } }),
      this.prisma.termHistory.create({ data: this.history(pid, user.id, 'DELETE', tid, before, null) }),
    ]);
    this.changed(pid, user);
  }

  async import(pid: string, user: AuthUser, text: string, overwrite = false) {
    const userId = user.id;
    const rows = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
      .map(parseLine)
      .filter((cols) => cols[0] && cols[1]);
    if (!rows.length) throw fail('NO_TERMS_TO_IMPORT');
    let created = 0;
    let updated = 0;
    const log: Prisma.TermHistoryCreateManyInput[] = [];
    const batchId = randomUUID();
    for (const [term, translation, note = ''] of rows) {
      const exist = await this.prisma.term.findUnique({ where: { projectId_term: { projectId: pid, term } } });
      if (!exist) {
        const t = await this.prisma.term.create({ data: { projectId: pid, term, translation, note, createdById: userId } });
        log.push(this.history(pid, userId, 'IMPORT', t.id, null, t));
        created++;
      } else if (overwrite) {
        const t = await this.prisma.term.update({ where: { id: exist.id }, data: { translation, note } });
        if (JSON.stringify(snap(exist)) !== JSON.stringify(snap(t))) log.push(this.history(pid, userId, 'IMPORT', t.id, exist, t));
        updated++;
      }
    }
    for (const part of chunk(log, 2000)) await this.prisma.termHistory.createMany({ data: part.map((l) => ({ ...l, batchId })) });
    await this.activity.log(pid, userId, 'terms.import', { created, updated });
    if (log.length) this.changed(pid, user);
    return { created, updated, skipped: rows.length - created - updated };
  }
}
