/**
 * Aviso de aba que ainda não tem conteúdo.
 *
 * Sem mock e sem número inventado, de propósito: tela que finge ter dado é pior
 * que tela honestamente vazia — quem abre não tem como saber que o que está
 * vendo não é real, e é o mesmo instinto da Regra 7, que manda gravar lacuna em
 * vez de zero.
 */
export function EmImplementacao({ children }: { children: React.ReactNode }) {
  return (
    <p className="border-border text-fg-muted rounded-lg border border-dashed p-5 text-sm">
      <span className="text-fg-subtle font-mono text-xs tracking-widest uppercase">
        Em implementação
      </span>
      <span className="mt-2 block">{children}</span>
    </p>
  );
}
