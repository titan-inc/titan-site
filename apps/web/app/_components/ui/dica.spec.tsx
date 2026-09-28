// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Dica } from './dica';

/** `setAberto`/`setPosicao` disparam de dentro de `setTimeout`, fora de
 * qualquer handler de evento do React — sem `act()`, o avanço do relógio
 * falso aplica o estado, mas o teste lê o DOM antes do React repintar. */
function avancar(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe('Dica', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('não sabe o que é o gatilho nem o conteúdo — só repassa', () => {
    render(
      <Dica gatilho={<span>passe o mouse</span>}>
        <p>conteúdo qualquer</p>
      </Dica>,
    );

    expect(screen.getByText('passe o mouse')).toBeTruthy();
    expect(screen.queryByText('conteúdo qualquer')).toBeNull(); // fechado até o hover.
  });

  it('não abre antes do atraso', () => {
    render(<Dica gatilho={<span>item</span>}>conteúdo</Dica>);

    fireEvent.mouseEnter(screen.getByText('item'));
    avancar(349);

    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('abre depois do atraso, em hover parado', () => {
    render(<Dica gatilho={<span>item</span>}>conteúdo</Dica>);

    fireEvent.mouseEnter(screen.getByText('item'));
    avancar(350);

    expect(screen.getByRole('tooltip')).toBeTruthy();
  });

  it('sair do gatilho antes do atraso cancela a abertura', () => {
    render(<Dica gatilho={<span>item</span>}>conteúdo</Dica>);

    const gatilho = screen.getByText('item');
    fireEvent.mouseEnter(gatilho);
    avancar(200);
    fireEvent.mouseLeave(gatilho);
    avancar(10_000);

    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('fecha um tempo depois de sair do gatilho', () => {
    render(<Dica gatilho={<span>item</span>}>conteúdo</Dica>);

    const gatilho = screen.getByText('item');
    fireEvent.mouseEnter(gatilho);
    avancar(350);
    expect(screen.getByRole('tooltip')).toBeTruthy();

    fireEvent.mouseLeave(gatilho);
    avancar(99);
    expect(screen.getByRole('tooltip')).toBeTruthy(); // ainda no vão de graça.

    avancar(1);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('mover o cursor para DENTRO do popover não fecha — o vão de graça existe para isso', () => {
    render(<Dica gatilho={<span>item</span>}>conteúdo do popover</Dica>);

    const gatilho = screen.getByText('item');
    fireEvent.mouseEnter(gatilho);
    avancar(350);

    fireEvent.mouseLeave(gatilho);
    avancar(50); // ainda dentro do atraso de fechar.
    fireEvent.mouseEnter(screen.getByRole('tooltip'));
    avancar(10_000);

    expect(screen.getByRole('tooltip')).toBeTruthy();
  });

  it('sair do popover fecha, do mesmo jeito que sair do gatilho', () => {
    render(<Dica gatilho={<span>item</span>}>conteúdo</Dica>);

    fireEvent.mouseEnter(screen.getByText('item'));
    avancar(350);
    const popover = screen.getByRole('tooltip');
    fireEvent.mouseEnter(popover);
    fireEvent.mouseLeave(popover);
    avancar(100);

    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('o popover é um portal — vive fora da árvore do gatilho', () => {
    const { container } = render(<Dica gatilho={<span>item</span>}>conteúdo</Dica>);

    fireEvent.mouseEnter(screen.getByText('item'));
    avancar(350);

    expect(container.querySelector('[role="tooltip"]')).toBeNull();
    expect(document.body.querySelector('[role="tooltip"]')).toBeTruthy();
  });

  it('desmontar com o timer pendente não estoura', () => {
    const { unmount } = render(<Dica gatilho={<span>item</span>}>conteúdo</Dica>);

    fireEvent.mouseEnter(screen.getByText('item'));
    expect(() => {
      unmount();
      avancar(10_000);
    }).not.toThrow();
  });
});
