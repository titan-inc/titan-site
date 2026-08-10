import 'server-only';

import {
  attendanceReportSchema,
  myAttendanceSchema,
  officerListSchema,
  progressReportSchema,
  raidProgressReportSchema,
  rosterSchema,
  sessionUserSchema,
  type AttendanceReport,
  type MyAttendance,
  type OfficerList,
  type ProgressReport,
  type RaidProgressReport,
  type Roster,
  type SessionUser,
} from '@titan/shared';
import { cookies } from 'next/headers';
import { API_URL, SESSION_COOKIE } from './config';

/**
 * Chamadas à API que dependem do cookie de sessão.
 *
 * `server-only` no topo: se um client component importar isto, o build falha com
 * mensagem clara em vez do erro confuso de `next/headers` no bundle do browser.
 * Valores seguros no cliente ficam em ./config.
 */

/**
 * Repassa o cookie de sessão para a API.
 *
 * Necessário porque o fetch de Server Component não herda os cookies do browser
 * automaticamente — sem isso a API vê todo request como deslogado.
 */
async function sessionHeader(): Promise<HeadersInit> {
  const store = await cookies();
  const session = store.get(SESSION_COOKIE)?.value;
  return session ? { Cookie: `${SESSION_COOKIE}=${session}` } : {};
}

/**
 * Usuário da sessão atual, ou null se não houver.
 *
 * Não lança em 401: "deslogado" é estado esperado, não erro.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  try {
    const res = await fetch(`${API_URL}/auth/me`, {
      headers: await sessionHeader(),
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return null;

    const parsed = sessionUserSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    // API fora do ar. Tratar como deslogado é melhor que quebrar a página.
    return null;
  }
}

export interface InternalSummary {
  greeting: string;
  matchedCharacter: SessionUser['matchedCharacter'];
  guildRank: number | null;
}

/** Dados da área interna. Null se a API recusar (401/403). */
export async function getInternalSummary(): Promise<InternalSummary | null> {
  try {
    const res = await fetch(`${API_URL}/internal/summary`, {
      headers: await sessionHeader(),
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return null;
    return (await res.json()) as InternalSummary;
  } catch {
    return null;
  }
}

/**
 * Roster do time de raid.
 *
 * Null quando a API recusa (401/403) ou está fora do ar. A página trata isso
 * como "sem dado", não como erro — Regra 6.
 */
export async function getRoster(): Promise<Roster | null> {
  try {
    const res = await fetch(`${API_URL}/internal/roster`, {
      headers: await sessionHeader(),
      cache: 'no-store',
      // Mais generoso que os outros: esta chamada espera o WoWAudit e ate 22
      // perfis do Raider.IO na primeira vez, antes do cache do Nest esquentar.
      signal: AbortSignal.timeout(20000),
    });

    if (!res.ok) return null;

    const parsed = rosterSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Relatório de progressão da season.
 *
 * Null tanto para "API recusou" quanto para "ainda não há semana gravada" — a
 * página trata os dois como "sem dado ainda", que é o estado esperado no
 * começo e não merece tela de erro.
 */
export async function getProgress(season?: string): Promise<ProgressReport | null> {
  const query = season ? `?season=${encodeURIComponent(season)}` : '';

  try {
    const res = await fetch(`${API_URL}/internal/progress${query}`, {
      headers: await sessionHeader(),
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) return null;

    const body: unknown = await res.json();
    if (body === null) return null;

    const parsed = progressReportSchema.safeParse(body);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Progressão de raid do tier, do Warcraft Logs.
 *
 * Null cobre três casos que a página trata igual: API recusou, nenhuma season
 * gravada ainda, e Warcraft Logs fora do ar sem cache. Nenhum deles é tela de
 * erro — Regra 6 manda degradar, não quebrar.
 */
export async function getRaidProgress(season?: string): Promise<RaidProgressReport | null> {
  const query = season ? `?season=${encodeURIComponent(season)}` : '';

  try {
    const res = await fetch(`${API_URL}/internal/raid-progress${query}`, {
      headers: await sessionHeader(),
      cache: 'no-store',
      // Generoso: na primeira leitura da season o Nest lê ~134 relatórios do
      // Warcraft Logs antes de o cache dele esquentar.
      signal: AbortSignal.timeout(25000),
    });

    if (!res.ok) return null;

    const body: unknown = await res.json();
    if (body === null) return null;

    const parsed = raidProgressReportSchema.safeParse(body);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Presença de raid de todo mundo. **Só oficial** — Regra 7.
 *
 * Null quando a API recusa (403 para membro que não é oficial), e a página
 * trata isso como "esta seção não é para você", não como erro.
 */
export async function getAttendanceReport(): Promise<AttendanceReport | null> {
  try {
    const res = await fetch(`${API_URL}/internal/attendance`, {
      headers: await sessionHeader(),
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) return null;

    const parsed = attendanceReportSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/**
 * Lista de oficiais. **Só oficial** — quem tem acesso a dado pessoal de
 * candidato não é informação pública da guilda.
 *
 * Null quando a API recusa (403) ou está fora do ar.
 */
export async function getOfficers(): Promise<OfficerList | null> {
  try {
    const res = await fetch(`${API_URL}/internal/officers`, {
      headers: await sessionHeader(),
      cache: 'no-store',
      // Generoso porque a lista busca o roster da Blizzard para mostrar o rank
      // de cada grant; com o cache do Nest frio isso é uma chamada externa.
      signal: AbortSignal.timeout(20000),
    });

    if (!res.ok) return null;

    const parsed = officerListSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** O próprio histórico de presença. Qualquer membro com acesso interno. */
export async function getMyAttendance(): Promise<MyAttendance | null> {
  try {
    const res = await fetch(`${API_URL}/internal/attendance/me`, {
      headers: await sessionHeader(),
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) return null;

    const parsed = myAttendanceSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
