/**
 * O calendário da rodada, no fuso da guilda (spec §5.1, §9; D-35).
 *
 * Cutoff: a próxima terça 12:00 local depois de `agora` — o reset US. Abertura:
 * a sexta 00:00 local antes do cutoff, o dia do job `bet-abre-rodada`. As duas
 * datas são calculadas na criação e não mudam (trigger `titanbet_rodada_imutavel`).
 */

const TERCA = 2;

export function proximaRodada(agora: Date, timezone: string): { cutoffAt: Date; opensAt: Date } {
  const hoje = partesLocais(agora, timezone);
  const diasAteTerca = (TERCA - hoje.diaDaSemana + 7) % 7;

  let cutoffAt = instanteLocal(hoje.ano, hoje.mes, hoje.dia + diasAteTerca, 12, timezone);
  if (cutoffAt.getTime() <= agora.getTime()) {
    cutoffAt = instanteLocal(hoje.ano, hoje.mes, hoje.dia + diasAteTerca + 7, 12, timezone);
  }

  const terca = partesLocais(cutoffAt, timezone);
  const opensAt = instanteLocal(terca.ano, terca.mes, terca.dia - 4, 0, timezone);
  return { cutoffAt, opensAt };
}

interface PartesLocais {
  ano: number;
  mes: number;
  dia: number;
  /** 0 = domingo. */
  diaDaSemana: number;
}

function partesLocais(instante: Date, timezone: string): PartesLocais {
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    weekday: 'short',
  }).formatToParts(instante);
  const valor = (tipo: string) => partes.find((p) => p.type === tipo)!.value;
  return {
    ano: Number(valor('year')),
    mes: Number(valor('month')),
    dia: Number(valor('day')),
    diaDaSemana: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(valor('weekday')),
  };
}

/**
 * O instante UTC de `ano-mes-dia hora:00` no relógio do fuso. `dia` pode
 * transbordar o mês — `Date.UTC` normaliza. O deslocamento do fuso é medido no
 * próprio instante, então horário de verão entra sozinho.
 */
function instanteLocal(
  ano: number,
  mes: number,
  dia: number,
  hora: number,
  timezone: string,
): Date {
  const alvo = Date.UTC(ano, mes - 1, dia, hora);
  let palpite = alvo;
  // Duas passadas bastam: a segunda corrige quando o palpite cruza a virada do horário de verão.
  for (let i = 0; i < 2; i++) palpite = alvo - deslocamento(new Date(palpite), timezone);
  return new Date(palpite);
}

/** Quanto o relógio local está à frente do UTC, em ms, naquele instante. */
function deslocamento(instante: Date, timezone: string): number {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(instante);
  const v = (tipo: string) => Number(p.find((x) => x.type === tipo)!.value);
  const comoUtc = Date.UTC(
    v('year'),
    v('month') - 1,
    v('day'),
    v('hour'),
    v('minute'),
    v('second'),
  );
  return comoUtc - Math.floor(instante.getTime() / 1000) * 1000;
}
