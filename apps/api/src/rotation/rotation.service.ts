import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  DEFAULT_ROTATION_SEATS,
  inicioDaSemana,
  motivoDaSugestao,
  rotationRoleSchema,
  semanasEntre,
  type CreatePlayerLock,
  type RotationLock,
  type RotationPlayer,
  type RotationRole,
  type RotationSuggestion,
  type RotationView,
  type SavePlan,
} from '@titan/shared';
import { chaveDe, CharactersRepository, indice } from '../characters/characters.repository';
import { loadGuildTimezone } from '../config/guild.config';
import { WowAuditService, type TeamCharacter } from '../wowaudit/wowaudit.service';
import { RotationRepository, type PresencaDaSemana } from './rotation.repository';

/** Time do WoWAudit já com a identidade do site resolvida. */
interface PessoaDoTime extends TeamCharacter {
  characterId: string;
  role: RotationRole;
}

/**
 * Rotação de banco.
 *
 * O time vem do WoWAudit, curado pelo raid leader — o site lê, não cadastra.
 * O que nasce aqui é o que o WoWAudit não responde: **há quanto tempo cada um
 * não descansa**, ao longo das semanas.
 */
@Injectable()
export class RotationService {
  private readonly timezone = loadGuildTimezone();

  constructor(
    private readonly wowaudit: WowAuditService,
    private readonly repo: RotationRepository,
    private readonly characters: CharactersRepository,
  ) {}

  /**
   * @param vagas sobrepõe quantos sentar, **só para este cálculo**. É o
   *   "Recalcular" da tela: nada é gravado até o oficial salvar o plano.
   */
  async getView(semana?: string, vagas?: number, fixos?: string[]): Promise<RotationView> {
    const weekStart = semana ? inicioDaSemana(semana) : this.semanaAtual();

    const snapshot = await this.wowaudit.getTeamCharactersSnapshot();
    const time = await this.resolverTime(snapshot.characters);
    const ids = time.map((p) => p.characterId);

    const [roleLocks, playerLocks, plano, ultimoBanco] = await Promise.all([
      this.repo.listRoleLocks(),
      this.repo.listPlayerLocks(),
      this.repo.findPlan(weekStart),
      this.ultimoBancoPorPessoa(ids, weekStart),
    ]);

    const rolesTravadas = new Set(roleLocks.map((r) => r.role));
    const travaPorPessoa = new Map(playerLocks.map((l) => [l.characterId, l]));

    const pool: RotationPlayer[] = time.map((p) => {
      const trava = travaPorPessoa.get(p.characterId);
      const ultimo = ultimoBanco.get(p.characterId) ?? null;

      let lock: RotationLock | null = null;
      if (trava) {
        lock = {
          kind: 'player',
          reason: trava.reason,
          weeks: semanasEntre(inicioDaSemana(this.dataLocal(trava.lockedAt)), weekStart),
          id: trava.id,
        };
      } else if (rolesTravadas.has(p.role)) {
        lock = { kind: 'role', reason: `${p.role} fora da rotação`, weeks: null, id: null };
      }

      return {
        characterId: p.characterId,
        name: p.name,
        realm: p.realm,
        wowClass: p.wowClass,
        role: p.role,
        weeksSinceBench: ultimo === null ? null : semanasEntre(ultimo, weekStart),
        lock,
      };
    });

    // Valor pedido > plano salvo > default. `Number('abc')` é NaN e toda
    // comparação com NaN é falsa, então um parâmetro lixo cairia em zero vaga
    // sem erro nenhum — daí a checagem explícita.
    const pedido = vagas !== undefined && Number.isInteger(vagas) && vagas >= 0 ? vagas : null;
    const seats = pedido ?? plano?.seats ?? DEFAULT_ROTATION_SEATS;

    // Sem `fixos` explícito, valem os do plano salvo — assim recarregar a tela
    // não perde uma fixação que o RL já tinha decidido.
    const fixados = new Set(
      fixos ?? plano?.entries.filter((e) => e.pinned).map((e) => e.characterId) ?? [],
    );

    return {
      weekStart,
      seats,
      roleLocks: [...rolesTravadas].filter(this.ehRole),
      pool,
      suggestion: this.sugerir(pool, seats, fixados),
      saved: plano
        ? {
            seats: plano.seats,
            characterIds: plano.entries.map((e) => e.characterId),
            pinned: plano.entries.filter((e) => e.pinned).map((e) => e.characterId),
            savedBy: plano.savedBy,
            savedAt: plano.savedAt.toISOString(),
          }
        : null,
      teamStale: snapshot.stale,
    };
  }

  /**
   * Quem senta, e por quê.
   *
   * Duas decisões, nesta ordem:
   *
   * **Quantas vagas cada role recebe** — proporcional ao tamanho da role no
   * time, pelo método D'Hondt. Sem isso a sugestão desanda no começo: enquanto
   * quase todo mundo está empatado em "nunca sentou", o desempate por nome
   * sentava 3 dos 6 healers e quebrava a raid. Com 2 tanks, 6 healers, 10 melee
   * e 8 ranged, 5 vagas viram 2 melee, 2 ranged e 1 healer — que por acaso é a
   * regra que a liderança já seguia, sem estar escrita em lugar nenhum.
   *
   * É o "equilibrar melee vs range quando possível" do pedido, sem precisar de
   * comp alvo: a proporção sai do próprio time.
   *
   * **Quem, dentro da role** — quem está há mais tempo sem descansar, com
   * nunca-sentou na frente. Desempate por nome para a mesma entrada devolver
   * sempre a mesma lista; sugestão que muda sozinha a cada refresh não é
   * defensável no Discord.
   *
   * **Nunca é o plano.** Quem decide é o oficial; isto é o primeiro rascunho.
   */
  private sugerir(
    pool: RotationPlayer[],
    seats: number,
    fixos: ReadonlySet<string>,
  ): RotationSuggestion[] {
    const livres = pool.filter((p) => p.lock === null);
    const vagas = Math.min(Math.max(0, seats), livres.length);

    // Fixado travado sai junto: quem está fora da rotação não pode estar no
    // banco, mesmo tendo sido posto à mão antes da trava existir.
    const fixados = livres.filter((p) => fixos.has(p.characterId));
    if (vagas === 0 && fixados.length === 0) return [];

    const filas = new Map<RotationRole, RotationPlayer[]>();
    for (const p of livres) {
      if (fixos.has(p.characterId)) continue;
      const fila = filas.get(p.role);
      if (fila) fila.push(p);
      else filas.set(p.role, [p]);
    }

    // O tamanho da role conta os fixados junto: a proporção é sobre o time
    // inteiro, não sobre quem sobrou depois de fixar.
    const tamanho = new Map<RotationRole, number>();
    for (const p of livres) tamanho.set(p.role, (tamanho.get(p.role) ?? 0) + 1);

    for (const fila of filas.values()) {
      fila.sort((a, b) => {
        const va = a.weeksSinceBench ?? Number.POSITIVE_INFINITY;
        const vb = b.weeksSinceBench ?? Number.POSITIVE_INFINITY;
        if (va !== vb) return vb - va;
        return `${a.name}-${a.realm}`.localeCompare(`${b.name}-${b.realm}`);
      });
    }

    // Os fixados entram primeiro e **consomem vaga da role deles**. Sem isso,
    // fixar um melee daria um melee a mais no banco e desequilibraria o que o
    // D'Hondt existe para equilibrar.
    //
    // Se o RL fixar mais gente que as vagas, todos ficam: recusar a decisão
    // dele seria a ferramenta mandando em quem ela deveria ajudar.
    const escolhidos: RotationPlayer[] = [...fixados];
    const usadas = new Map<RotationRole, number>();
    for (const p of fixados) usadas.set(p.role, (usadas.get(p.role) ?? 0) + 1);

    while (escolhidos.length < vagas) {
      let melhor: RotationRole | null = null;
      let maior = -1;

      for (const [role, fila] of filas) {
        if (fila.length === 0) continue;

        // D'Hondt: a role com a maior razão entre tamanho e vagas já usadas
        // leva a próxima. Role grande recebe mais, e nenhuma é zerada.
        const quociente = (tamanho.get(role) ?? 0) / ((usadas.get(role) ?? 0) + 1);
        if (quociente > maior) {
          maior = quociente;
          melhor = role;
        }
      }

      // Todas as filas esgotaram antes de encher as vagas.
      if (melhor === null) break;

      const escolhido = filas.get(melhor)?.shift();
      if (!escolhido) break;

      escolhidos.push(escolhido);
      usadas.set(melhor, (usadas.get(melhor) ?? 0) + 1);
    }

    return escolhidos.map((p) => ({
      characterId: p.characterId,
      name: p.name,
      realm: p.realm,
      role: p.role,
      reason: motivoDaSugestao(p.weeksSinceBench),
      pinned: fixos.has(p.characterId),
    }));
  }

  /**
   * A semana do último banco **cumprido** de cada pessoa.
   *
   * Duas fontes, e a mais recente vence:
   *
   * - o plano salvo, cruzado com a presença daquela semana;
   * - o `Standby` já gravado na presença, que é o histórico de onde a primeira
   *   sugestão é extrapolada, antes de existir plano nenhum.
   *
   * O cruzamento é o ponto: quem foi sentado e apareceu descansou, quem foi
   * sentado e sumiu **não**. Contar os dois igual daria crédito de descanso a
   * quem faltou — invertendo o incentivo que o sigilo do banco existe para
   * proteger. Ver a Regra 7 do CLAUDE.md.
   */
  private async ultimoBancoPorPessoa(
    characterIds: string[],
    weekStart: string,
  ): Promise<Map<string, string>> {
    const [entries, standbys] = await Promise.all([
      this.repo.listPlanEntries(characterIds),
      this.repo.listStandbys(characterIds),
    ]);

    const ultimo = new Map<string, string>();
    const guarda = (characterId: string, semana: string) => {
      // Semana futura não conta como descanso já cumprido: o plano desta semana
      // ainda vai acontecer.
      if (semana >= weekStart) return;
      const atual = ultimo.get(characterId);
      if (!atual || semana > atual) ultimo.set(characterId, semana);
    };

    for (const s of standbys) guarda(s.characterId, inicioDaSemana(s.raidNight.date));

    // Um plano só conta depois de conferido contra a presença daquela semana,
    // então as semanas planejadas são buscadas de uma vez.
    const semanas = [...new Set(entries.map((e) => e.plan.weekStart))].filter((w) => w < weekStart);

    if (semanas.length > 0) {
      const de = semanas.reduce((a, b) => (a < b ? a : b));
      const ate = this.fimDaSemana(semanas.reduce((a, b) => (a > b ? a : b)));
      const presenca = await this.repo.listPresenca(characterIds, de, ate);

      for (const e of entries) {
        if (e.plan.weekStart >= weekStart) continue;
        if (this.apareceu(presenca, e.characterId, e.plan.weekStart)) {
          guarda(e.characterId, e.plan.weekStart);
        }
      }
    }

    return ultimo;
  }

  /**
   * A pessoa apareceu em alguma noite daquela semana?
   *
   * **Sem evidência, responde que sim.** Semana sem linha de presença é lacuna
   * de coleta, não prova de ausência — e transformar lacuna em falta puniria
   * alguém por o job não ter rodado. É a mesma regra do `sem-dado` da presença.
   */
  private apareceu(presenca: PresencaDaSemana[], characterId: string, weekStart: string): boolean {
    const fim = this.fimDaSemana(weekStart);
    const daSemana = presenca.filter(
      (p) => p.characterId === characterId && p.date >= weekStart && p.date <= fim,
    );

    if (daSemana.length === 0) return true;

    return daSemana.some(
      (p) =>
        p.raided === true ||
        p.signup === 'Standby' ||
        p.signup === 'Present' ||
        p.signup === 'Late',
    );
  }

  async setRoleLocks(roles: RotationRole[], autor: string): Promise<RotationView> {
    await this.repo.setRoleLocks([...new Set(roles)], autor);
    return this.getView();
  }

  /**
   * Trava uma pessoa.
   *
   * Recusa quem não está no time do WoWAudit: travar alguém de fora não faz
   * nada visível e fica no banco para sempre, sem ninguém entender por quê.
   */
  async createPlayerLock(body: CreatePlayerLock, autor: string): Promise<RotationView> {
    const time = await this.resolverTime(await this.wowaudit.getTeamCharacters());
    if (!time.some((p) => p.characterId === body.characterId)) {
      throw new BadRequestException('Esse personagem não está no time de raid do WoWAudit');
    }

    await this.repo.createPlayerLock(body.characterId, body.reason.trim(), autor);
    return this.getView();
  }

  async deletePlayerLock(id: string): Promise<RotationView> {
    try {
      await this.repo.deletePlayerLock(id);
    } catch {
      throw new NotFoundException(`Trava ${id} não existe`);
    }
    return this.getView();
  }

  /**
   * Salva o plano da semana.
   *
   * Aceita qualquer conjunto, inclusive um que contrarie a sugestão ou o
   * `seats`: quem decide é o oficial, e recusar a decisão dele por não bater
   * com o cálculo seria a ferramenta mandando em quem ela deveria ajudar.
   */
  async savePlan(body: SavePlan, autor: string): Promise<RotationView> {
    const weekStart = inicioDaSemana(body.weekStart);
    const ids = [...new Set(body.characterIds)];

    const time = await this.resolverTime(await this.wowaudit.getTeamCharacters());
    const doTime = new Set(time.map((p) => p.characterId));

    const forasteiros = ids.filter((id) => !doTime.has(id));
    if (forasteiros.length > 0) {
      throw new BadRequestException(
        `${forasteiros.length} personagem(ns) do plano não estão no time de raid`,
      );
    }

    // Fixar quem não está no banco não quer dizer nada, e gravado assim viraria
    // uma fixação fantasma que reaparece no próximo recálculo.
    const fixados = [...new Set(body.pinned)];
    if (fixados.some((id) => !ids.includes(id))) {
      throw new BadRequestException('Só dá para fixar quem está no banco');
    }

    await this.repo.savePlan(weekStart, body.seats, ids, fixados, autor);
    return this.getView(weekStart);
  }

  /**
   * Casa o time do WoWAudit com as identidades do site.
   *
   * Role que o WoWAudit devolva fora das quatro conhecidas derruba a pessoa da
   * lista em vez da requisição: um valor novo do lado deles não pode fechar a
   * tela de rotação inteira.
   */
  private async resolverTime(team: TeamCharacter[]): Promise<PessoaDoTime[]> {
    const validos = team.flatMap((c) => {
      const role = rotationRoleSchema.safeParse(c.role);
      return role.success ? [{ ...c, role: role.data }] : [];
    });

    const ids = await this.characters.resolverVarios(
      validos.map((c) => ({ name: c.name, realm: c.realm, class: c.wowClass })),
    );

    return validos.flatMap((c) => {
      const characterId = ids.get(indice(chaveDe({ name: c.name, realm: c.realm })));
      return characterId ? [{ ...c, characterId }] : [];
    });
  }

  private ehRole = (r: string): r is RotationRole => rotationRoleSchema.safeParse(r).success;

  /** O domingo da semana que começa naquela segunda. */
  private fimDaSemana(weekStart: string): string {
    const d = new Date(`${weekStart}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 6);
    return d.toISOString().slice(0, 10);
  }

  private semanaAtual(): string {
    return inicioDaSemana(this.dataLocal(new Date()));
  }

  /** Data de calendário no fuso da guilda — a mesma régua do resto do site. */
  private dataLocal(quando: Date): string {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: this.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(quando);
  }
}
