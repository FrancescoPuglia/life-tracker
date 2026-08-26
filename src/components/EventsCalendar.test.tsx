// src/components/EventsCalendar.test.tsx
// Smoke + interaction tests for the redesigned Strategic Calendar.
// The component reads events from localStorage; jsdom provides one. We clear
// it in beforeEach so the empty state is the default.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import EventsCalendar from './EventsCalendar';

beforeEach(() => {
  window.localStorage.clear();
});
afterEach(() => {
  window.localStorage.clear();
});

describe('EventsCalendar — premium shell', () => {
  it('renders the calendar shell with the strategic role and active-events line', () => {
    render(<EventsCalendar />);
    expect(screen.getByTestId('events-calendar')).toBeInTheDocument();
    expect(screen.getByText(/Calendario strategico/i)).toBeInTheDocument();
    // 0 active events on first paint.
    expect(screen.getByText(/0 eventi attivi/i)).toBeInTheDocument();
  });

  it('shows the new event CTA in the header', () => {
    render(<EventsCalendar />);
    const btn = screen.getByTestId('calendar-add-event');
    expect(btn).toBeInTheDocument();
    expect(btn.textContent).toMatch(/Nuovo evento/i);
  });

  it('highlights today with a dedicated test id', () => {
    render(<EventsCalendar />);
    expect(screen.getByTestId('calendar-today-cell')).toBeInTheDocument();
  });

  it('renders the Today (jump) button in month navigation', () => {
    render(<EventsCalendar />);
    expect(screen.getByTestId('calendar-today')).toBeInTheDocument();
  });
});

describe('EventsCalendar — empty state & CTA wiring', () => {
  it('renders the premium full-card empty state when there are zero events', () => {
    render(<EventsCalendar />);
    const empty = screen.getByTestId('calendar-empty-state');
    expect(empty).toBeInTheDocument();
    expect(empty.textContent).toMatch(/Nessun evento strategico pianificato/i);
  });

  it('exposes "Add Event" inside the empty state too', () => {
    render(<EventsCalendar />);
    expect(screen.getByTestId('calendar-empty-add-event')).toBeInTheDocument();
  });

  it('shows "Generate Weekly Plan" CTA only when onNavigate is provided', () => {
    const { rerender } = render(<EventsCalendar />);
    // No onNavigate → no header CTA, no empty-state CTA.
    expect(screen.queryByTestId('calendar-generate-weekly-plan')).toBeNull();
    expect(screen.queryByTestId('calendar-empty-generate-weekly')).toBeNull();

    rerender(<EventsCalendar onNavigate={() => {}} />);
    expect(screen.getByTestId('calendar-generate-weekly-plan')).toBeInTheDocument();
    expect(screen.getByTestId('calendar-empty-generate-weekly')).toBeInTheDocument();
  });

  it('fires onNavigate("weekly_intel") when the header CTA is clicked', () => {
    const onNavigate = vi.fn();
    render(<EventsCalendar onNavigate={onNavigate} />);
    fireEvent.click(screen.getByTestId('calendar-generate-weekly-plan'));
    expect(onNavigate).toHaveBeenCalledWith('weekly_intel');
  });

  it('fires onNavigate("weekly_intel") when the empty-state CTA is clicked', () => {
    const onNavigate = vi.fn();
    render(<EventsCalendar onNavigate={onNavigate} />);
    fireEvent.click(screen.getByTestId('calendar-empty-generate-weekly'));
    expect(onNavigate).toHaveBeenCalledWith('weekly_intel');
  });
});
