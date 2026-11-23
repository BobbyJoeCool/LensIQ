import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Popover } from './ui';

function openAt(buttonBottom: number, innerHeight: number) {
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(innerHeight);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
    top: buttonBottom - 36,
    bottom: buttonBottom,
    left: 300,
    right: 380,
    width: 80,
    height: 36,
    x: 300,
    y: buttonBottom - 36,
    toJSON: () => ({}),
  });
  render(<Popover label="Highlight">{() => <p>Rules</p>}</Popover>);
  return userEvent.click(screen.getByRole('button', { name: 'Highlight' }));
}

const panel = () => screen.getByText('Rules').parentElement!;

describe('Popover', () => {
  afterEach(() => vi.restoreAllMocks());

  it('caps its height at the room left below the button, so its scroll reaches the end (#63)', async () => {
    await openAt(240, 720);
    // Opens 4px under the button (top 244) and stops 16px above the bottom: 720 - 244 - 16.
    expect(panel().style.top).toBe('244px');
    expect(panel().style.maxHeight).toBe('460px');
  });

  it('a button near the top gets nearly the whole screen', async () => {
    await openAt(40, 900);
    expect(panel().style.maxHeight).toBe(`${900 - 44 - 16}px`);
  });

  it('never shrinks below a usable height when the button is near the bottom', async () => {
    await openAt(700, 720);
    expect(panel().style.maxHeight).toBe('160px');
  });
});
