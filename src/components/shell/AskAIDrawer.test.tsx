// src/components/shell/AskAIDrawer.test.tsx

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import AskAIDrawer from './AskAIDrawer';

describe('AskAIDrawer', () => {
  it('renders nothing when closed', () => {
    render(<AskAIDrawer open={false} onClose={() => {}} />);
    expect(screen.queryByTestId('ai-drawer')).toBeNull();
  });

  it('renders panel + close button when open', () => {
    render(<AskAIDrawer open={true} onClose={() => {}} />);
    expect(screen.getByTestId('ai-drawer')).toBeInTheDocument();
    expect(screen.getByTestId('ai-drawer-panel')).toBeInTheDocument();
    expect(screen.getByTestId('ai-drawer-close')).toBeInTheDocument();
  });

  it('fires onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(<AskAIDrawer open={true} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('ai-drawer-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('fires onClose when the backdrop is clicked', () => {
    const onClose = vi.fn();
    render(<AskAIDrawer open={true} onClose={onClose} />);
    fireEvent.click(screen.getByTestId('ai-drawer-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('fires onClose on Escape', () => {
    const onClose = vi.fn();
    render(<AskAIDrawer open={true} onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders children when not in static deployment mode', () => {
    render(
      <AskAIDrawer open={true} onClose={() => {}} backendConfigured={true}>
        <div data-testid="ai-child">child content</div>
      </AskAIDrawer>,
    );
    expect(screen.getByTestId('ai-child')).toBeInTheDocument();
    expect(screen.queryByTestId('ai-drawer-configuration-notice')).toBeNull();
  });

  it('renders setup guidance when the external backend is not configured', () => {
    render(
      <AskAIDrawer open={true} onClose={() => {}} backendConfigured={false}>
        <div data-testid="ai-child">child content</div>
      </AskAIDrawer>,
    );
    expect(screen.getByTestId('ai-drawer-configuration-notice')).toBeInTheDocument();
    expect(screen.queryByTestId('ai-child')).toBeNull();
  });

  it('keeps AI available in a static export when an external backend is configured', () => {
    render(
      <AskAIDrawer open={true} onClose={() => {}} backendConfigured={true}>
        <div data-testid="ai-child">external backend</div>
      </AskAIDrawer>,
    );

    expect(screen.getByTestId('ai-child')).toHaveTextContent('external backend');
  });

  it('keeps secure action state mounted while the drawer is closed', () => {
    function StatefulChild() {
      const [count, setCount] = useState(0);
      return <button type="button" onClick={() => setCount((value) => value + 1)}>Action state {count}</button>;
    }
    const child = <StatefulChild />;
    const { rerender } = render(
      <AskAIDrawer open onClose={() => {}} backendConfigured>{child}</AskAIDrawer>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Action state 0' }));
    rerender(<AskAIDrawer open={false} onClose={() => {}} backendConfigured>{child}</AskAIDrawer>);
    expect(screen.queryByTestId('ai-drawer')).toBeNull();
    rerender(<AskAIDrawer open onClose={() => {}} backendConfigured>{child}</AskAIDrawer>);
    expect(screen.getByRole('button', { name: 'Action state 1' })).toBeInTheDocument();
  });

  it('traps keyboard focus and restores it to the opener', () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setOpen(true)}>Open assistant</button>
          <AskAIDrawer open={open} onClose={() => setOpen(false)} backendConfigured>
            <button type="button">Last action</button>
          </AskAIDrawer>
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Open assistant' });
    opener.focus();
    fireEvent.click(opener);
    const close = screen.getByTestId('ai-drawer-close');
    const last = screen.getByRole('button', { name: 'Last action' });
    expect(close).toHaveFocus();
    close.focus();
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(last).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Tab' });
    expect(close).toHaveFocus();
    fireEvent.click(close);
    expect(opener).toHaveFocus();
  });
});
