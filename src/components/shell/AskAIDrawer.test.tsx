// src/components/shell/AskAIDrawer.test.tsx

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
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
});
