import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { toCharacterKey, toRealmMatchKey } from '@titan/shared';
import { CharactersRepository } from '../characters/characters.repository';
import { amostraUm, amostrarAte, sortearEntre } from '../common/random';
import { LootSessionsRepository, type Ator, type SessionRow } from './loot-sessions.repository';
import { LootSessionsService } from './loot-sessions.service';

/** A cada quantos ms um ciclo de simulação roda. */
const TICK_MS = 2_000;

/** Kill switch — conta a partir do INÍCIO da simulação, não da sessão. */
const KILL_SWITCH_MS = 10 * 60 * 1_000;

const MIN_DUMMIES = 2;
const MAX_DUMMIES = 10;
const DEFAULT_DUMMIES = 6;

/** Nunca um realm real — identificável de longe como dado de teste. */
const DUMMY_REALM = 'TestDummy';

/** Arbitrário: os dummies nunca passam por `MemberGuard`, então rank não decide nada aqui. */
const DUMMY_RANK = 99;

/** Fictícias, para variar as respostas em `aberta` — nunca texto de gente real. */
const NOTAS_DE_TESTE = [
  'quero pra offspec',
  'upgrade grande pra mim',
  'só de brincadeira, pode ir pro outro',
  'preciso pro tier',
] as const;

/** Chance de uma resposta em `aberta` vir com nota — o resto vem sem. */
const CHANCE_DE_NOTA = 0.3;

interface Dummy {
  name: string;
  realm: string;
  nameKey: string;
  realmKey: string;
  ator: Ator;
}

export interface ResultadoRodarDummies {
  dummies: Array<{ name: string; realm: string }>;
  killSwitchAt: string;
}

/** Par (nameKey, realmKey) como chave — Regra 6, nunca o nome sozinho. */
function chaveDoPersonagem(p: { nameKey: string; realmKey: string }): string {
  return `${p.nameKey}|${p.realmKey}`;
}

/**
 * Simula jogadores numa sessão de loot ao vivo — TIT-68, ferramenta de teste
 * do realtime.
 *
 * Personagens 100% SINTÉTICOS (`Dummy1..DummyN` num realm de teste), nunca um
 * personagem real: mesmo cuidado de "usar dados fictícios em teste" do
 * CLAUDE.md, só que persistido — outro membro que abrir a sessão de verdade
 * não pode ver "Fulano" respondendo sozinho.
 *
 * Regra 8: nada de `NestFactory` nem processo à parte — é um `setInterval`
 * dentro do processo já rodando, chamando os MESMOS services que a rota HTTP
 * real chama (`LootSessionsService`), só que sem cookie de sessão no meio.
 * Estado em memória, por sessão: reinício da API derruba a simulação, e tudo
 * bem — é ferramenta de dev, não fluxo de produção.
 */
@Injectable()
export class LootSessionDummiesService {
  private readonly logger = new Logger(LootSessionDummiesService.name);
  private readonly emExecucao = new Map<string, NodeJS.Timeout>();
  private readonly ticando = new Set<string>();

  constructor(
    private readonly sessions: LootSessionsService,
    private readonly repo: LootSessionsRepository,
    private readonly characters: CharactersRepository,
  ) {}

  /**
   * Sobe a simulação: cria/entra os dummies e arma o ciclo de 2 em 2s.
   * Devolve na hora — o loop roda em segundo plano até a sessão encerrar ou
   * o kill switch de 10min bater, o que vier primeiro.
   */
  async rodar(sessionId: string, quantidade?: number): Promise<ResultadoRodarDummies> {
    if (this.emExecucao.has(sessionId)) {
      throw new ConflictException(
        `Já existe uma simulação de dummies rodando para a sessão "${sessionId}"`,
      );
    }

    const sessao = await this.repo.findById(sessionId);
    if (!sessao) throw new NotFoundException(`Sessão "${sessionId}" não existe`);
    if (sessao.status === 'encerrada') {
      throw new BadRequestException('Sessão já encerrada — nada a simular');
    }

    const n = Math.min(Math.max(quantidade ?? DEFAULT_DUMMIES, MIN_DUMMIES), MAX_DUMMIES);
    const dummies = await this.criarEEntrarDummies(sessionId, n);

    const killSwitchAt = new Date(Date.now() + KILL_SWITCH_MS);
    const handle = setInterval(() => void this.tick(sessionId, dummies, killSwitchAt), TICK_MS);
    this.emExecucao.set(sessionId, handle);

    this.logger.log(
      `sessão ${sessionId}: simulação de dummies iniciada com ${n} dummies, ` +
        `kill switch às ${killSwitchAt.toISOString()}`,
    );

    return {
      dummies: dummies.map((d) => ({ name: d.name, realm: d.realm })),
      killSwitchAt: killSwitchAt.toISOString(),
    };
  }

  /** Cria (ou reaproveita, se já existirem de uma rodada anterior) e entra na sessão. */
  private async criarEEntrarDummies(sessionId: string, n: number): Promise<Dummy[]> {
    const dummies: Dummy[] = [];

    for (let i = 1; i <= n; i++) {
      const name = `Dummy${i}`;
      const realm = DUMMY_REALM;
      const ator: Ator = { userId: `dummy-${i}`, battletag: `${name}#TEST` };

      await this.characters.resolver({ name, realm });

      await this.sessions.entrar(sessionId, { characterName: name, characterRealm: realm }, ator, [
        { nameKey: toCharacterKey(name), realmSlug: realm, name, rank: DUMMY_RANK },
      ]);

      dummies.push({
        name,
        realm,
        nameKey: toCharacterKey(name),
        realmKey: toRealmMatchKey(realm),
        ator,
      });
    }

    return dummies;
  }

  private async tick(sessionId: string, dummies: Dummy[], killSwitchAt: Date): Promise<void> {
    // Reentrância: se o tick anterior ainda não terminou (DB lenta), pula
    // este em vez de empilhar chamadas concorrentes sobre a mesma sessão.
    if (this.ticando.has(sessionId)) return;
    this.ticando.add(sessionId);

    try {
      if (Date.now() >= killSwitchAt.getTime()) {
        this.parar(sessionId, 'kill switch de 10 minutos');
        return;
      }

      const sessao = await this.repo.findById(sessionId);
      if (!sessao || sessao.status === 'encerrada') {
        this.parar(sessionId, 'sessão encerrada');
        return;
      }

      if (sessao.status === 'aberta') {
        await this.agirNaFaseAberta(sessao, dummies);
      } else if (sessao.status === 'deliberando') {
        await this.agirNaFaseDeliberando(sessao, dummies);
      }
      // 'rascunho': ocioso — os dummies já entraram, só respondem quando abrir.
    } catch (erro: unknown) {
      this.logger.warn(
        `sessão ${sessionId}: tick da simulação falhou — ` +
          `${erro instanceof Error ? erro.message : String(erro)}`,
      );
    } finally {
      this.ticando.delete(sessionId);
    }
  }

  /**
   * Aberta: 1 ou 2 ações por ciclo, cada uma um dummy respondendo a uma
   * peça — escolhe opção, às vezes com nota. "Editar" não é um caminho à
   * parte: `responder()` já faz upsert, então responder de novo NA MESMA
   * peça é a edição.
   */
  private async agirNaFaseAberta(sessao: SessionRow, dummies: Dummy[]): Promise<void> {
    if (sessao.items.length === 0) return;

    const opcoes = await this.repo.findOpcoesDoJogador();
    if (opcoes.length === 0) return;

    const acoes = sortearEntre(1, 2);
    for (let i = 0; i < acoes; i++) {
      const dummy = amostraUm(dummies);
      const item = amostraUm(sessao.items);
      const slug = amostraUm(opcoes).slug;
      const note = Math.random() < CHANCE_DE_NOTA ? amostraUm(NOTAS_DE_TESTE) : undefined;

      await this.tentarResponder(sessao.id, item.id, slug, note, dummy);
    }
  }

  /**
   * Deliberando: os dummies não têm nada a fazer sozinhos — só reagem se o
   * loot master reabriu a resposta deles (`aguardandoNovaResposta`). É a
   * MESMA regra que `LootSessionsService.responder()` já aplica por baixo
   * (`exigirQuePossaResponderAgora`); filtramos antes só para não martelar
   * `responder()` em peças que ele recusaria de qualquer jeito.
   */
  private async agirNaFaseDeliberando(sessao: SessionRow, dummies: Dummy[]): Promise<void> {
    const porChave = new Map(dummies.map((d) => [chaveDoPersonagem(d), d]));

    const todas = await this.repo.findTodasAsRespostas(sessao.id);
    const reabertas = todas.filter(
      (r) => r.aguardandoNovaResposta && porChave.has(chaveDoPersonagem(r)),
    );
    if (reabertas.length === 0) return;

    const opcoes = await this.repo.findOpcoesDoJogador();
    if (opcoes.length === 0) return;

    for (const resposta of amostrarAte(reabertas, 2)) {
      const dummy = porChave.get(chaveDoPersonagem(resposta));
      if (!dummy) continue; // não deveria faltar, dado o filtro acima — defensivo

      const slug = amostraUm(opcoes).slug;
      await this.tentarResponder(sessao.id, resposta.itemId, slug, undefined, dummy);
    }
  }

  /**
   * A regra de fase (aberta livre, deliberando só se reaberto) já vive em
   * `LootSessionsService.responder()` — não duplicamos aqui. Se ele recusar
   * por qualquer motivo (corrida entre ticks, sessão mudou de fase no meio),
   * é só um dummy que não agiu neste ciclo, não um erro da ferramenta.
   */
  private async tentarResponder(
    sessionId: string,
    itemId: string,
    responseOptionSlug: string,
    note: string | undefined,
    dummy: Dummy,
  ): Promise<void> {
    try {
      await this.sessions.responder(sessionId, itemId, { responseOptionSlug, note }, dummy.ator);
    } catch (erro: unknown) {
      this.logger.debug(
        `sessão ${sessionId}: ${dummy.name} não conseguiu responder ao item ${itemId} — ` +
          `${erro instanceof Error ? erro.message : String(erro)}`,
      );
    }
  }

  private parar(sessionId: string, motivo: string): void {
    const handle = this.emExecucao.get(sessionId);
    if (handle) clearInterval(handle);
    this.emExecucao.delete(sessionId);
    this.ticando.delete(sessionId);

    this.logger.log(`sessão ${sessionId}: simulação de dummies encerrada — ${motivo}`);
  }
}
