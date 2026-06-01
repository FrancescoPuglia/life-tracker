// src/lib/goalArchitect/normalizer.test.ts

import { describe, expect, it } from 'vitest';
import {
  normalizeInputText,
  normalizeKeyResultUnitToken,
  normalizePriorityToken,
  normalizeSectionLabel,
  normalizeWhitespace,
  parseDateToken,
  parseHoursToken,
  removeKnownMetadataFromTitle,
  splitListItems,
  stripAccents,
} from './normalizer';

describe('normalizeInputText', () => {
  it('collapses horizontal whitespace and trims', () => {
    expect(normalizeInputText('  Goal:   Test    \n  Projects: A  ')).toBe(
      'Goal: Test\nProjects: A',
    );
  });

  it('replaces curly quotes and unicode dashes with ASCII', () => {
    expect(normalizeInputText('“Goal” – Test')).toBe('"Goal" - Test');
    expect(normalizeInputText('It’s on')).toBe("It's on");
  });
});

describe('stripAccents', () => {
  it('removes Italian and Latin accents', () => {
    expect(stripAccents('Università')).toBe('Universita');
    expect(stripAccents('Però')).toBe('Pero');
    expect(stripAccents('caffè')).toBe('caffe');
  });
});

describe('normalizeWhitespace / normalizeSectionLabel', () => {
  it('collapses whitespace', () => {
    expect(normalizeWhitespace('  a   b\nc  ')).toBe('a b c');
  });

  it('lowercases and strips trailing colon', () => {
    expect(normalizeSectionLabel('  Progetti :')).toBe('progetti');
    expect(normalizeSectionLabel('Progetti:')).toBe('progetti');
  });
});

describe('parseHoursToken', () => {
  it('parses simple hour forms', () => {
    expect(parseHoursToken('10h')).toBe(10);
    expect(parseHoursToken('10 h')).toBe(10);
    expect(parseHoursToken('10 ore')).toBe(10);
    expect(parseHoursToken('1 ora')).toBe(1);
    expect(parseHoursToken('2 hours')).toBe(2);
  });

  it('parses decimals with dot or comma', () => {
    expect(parseHoursToken('1.5h')).toBe(1.5);
    expect(parseHoursToken('1,5h')).toBe(1.5);
  });

  it('converts minutes to hours', () => {
    expect(parseHoursToken('90 min')).toBe(1.5);
    expect(parseHoursToken('90 minuti')).toBe(1.5);
    expect(parseHoursToken('30 minutes')).toBe(0.5);
  });

  it('returns undefined for bare numbers (no unit)', () => {
    expect(parseHoursToken('300')).toBeUndefined();
    expect(parseHoursToken('hello world')).toBeUndefined();
  });
});

describe('parseDateToken', () => {
  it('parses DD/MM/YYYY', () => {
    expect(parseDateToken('31/12/2026')).toBe('2026-12-31');
  });

  it('parses ISO YYYY-MM-DD', () => {
    expect(parseDateToken('2026-12-31')).toBe('2026-12-31');
  });

  it('parses Italian "DD <month> YYYY"', () => {
    expect(parseDateToken('31 dicembre 2026')).toBe('2026-12-31');
    expect(parseDateToken('5 gennaio 2027')).toBe('2027-01-05');
  });

  it('parses "entro <month> YYYY" as last day of month', () => {
    expect(parseDateToken('entro dicembre 2026')).toBe('2026-12-31');
    expect(parseDateToken('entro novembre 2026')).toBe('2026-11-30');
    expect(parseDateToken('by December 2026')).toBe('2026-12-31');
  });

  it('parses "end of YYYY" / "entro fine YYYY"', () => {
    expect(parseDateToken('end of 2026')).toBe('2026-12-31');
    expect(parseDateToken('entro fine 2026')).toBe('2026-12-31');
    expect(parseDateToken('by end of 2027')).toBe('2027-12-31');
  });

  it('returns undefined for unparseable input', () => {
    expect(parseDateToken('boh non lo so')).toBeUndefined();
    expect(parseDateToken('31/13/2026')).toBeUndefined(); // month 13
    expect(parseDateToken('32 dicembre 2026')).toBeUndefined();
    expect(parseDateToken('')).toBeUndefined();
  });
});

describe('normalizePriorityToken', () => {
  it('canonicalizes English/Italian aliases', () => {
    expect(normalizePriorityToken('urgente')).toBe('critical');
    expect(normalizePriorityToken('critico')).toBe('critical');
    expect(normalizePriorityToken('critica')).toBe('critical');
    expect(normalizePriorityToken('alta')).toBe('high');
    expect(normalizePriorityToken('alto')).toBe('high');
    expect(normalizePriorityToken('media')).toBe('medium');
    expect(normalizePriorityToken('medio')).toBe('medium');
    expect(normalizePriorityToken('bassa')).toBe('low');
    expect(normalizePriorityToken('basso')).toBe('low');
    expect(normalizePriorityToken('importante')).toBe('high');
    expect(normalizePriorityToken('HIGH')).toBe('high');
  });

  it('returns undefined for unknown', () => {
    expect(normalizePriorityToken('extreme')).toBeUndefined();
    expect(normalizePriorityToken('')).toBeUndefined();
    expect(normalizePriorityToken(undefined)).toBeUndefined();
  });
});

describe('normalizeKeyResultUnitToken', () => {
  it('maps Italian/English aliases to canonical units', () => {
    expect(normalizeKeyResultUnitToken('libri')).toBe('books');
    expect(normalizeKeyResultUnitToken('books')).toBe('books');
    expect(normalizeKeyResultUnitToken('corsi')).toBe('courses');
    expect(normalizeKeyResultUnitToken('courses')).toBe('courses');
    expect(normalizeKeyResultUnitToken('%')).toBe('percent');
    expect(normalizeKeyResultUnitToken('percent')).toBe('percent');
    expect(normalizeKeyResultUnitToken('percentuale')).toBe('percent');
    expect(normalizeKeyResultUnitToken('giorni')).toBe('days');
    expect(normalizeKeyResultUnitToken('sessioni')).toBe('sessions');
    expect(normalizeKeyResultUnitToken('studi')).toBe('studies');
    expect(normalizeKeyResultUnitToken('ore')).toBe('hours');
    expect(normalizeKeyResultUnitToken('video')).toBe('videos');
    expect(normalizeKeyResultUnitToken('task')).toBe('tasks');
  });

  it('returns undefined for unknown', () => {
    expect(normalizeKeyResultUnitToken('Elo')).toBeUndefined();
    expect(normalizeKeyResultUnitToken('xyz')).toBeUndefined();
    expect(normalizeKeyResultUnitToken('')).toBeUndefined();
    expect(normalizeKeyResultUnitToken(undefined)).toBeUndefined();
  });
});

describe('splitListItems', () => {
  it('splits a comma list', () => {
    expect(splitListItems('A, B, C')).toEqual(['A', 'B', 'C']);
  });

  it('preserves commas inside bullet items', () => {
    const input = ['- Career Command Center', '- ONU, FAO, WFP, IFAD'].join('\n');
    expect(splitListItems(input)).toEqual([
      'Career Command Center',
      'ONU, FAO, WFP, IFAD',
    ]);
  });

  it('drops empty / whitespace items', () => {
    expect(splitListItems('A,,B, ')).toEqual(['A', 'B']);
  });
});

describe('removeKnownMetadataFromTitle', () => {
  it('strips trailing hours and priority', () => {
    expect(removeKnownMetadataFromTitle('Catalana 10h critical')).toBe('Catalana');
    expect(removeKnownMetadataFromTitle('Sveshnikov 15h critical')).toBe('Sveshnikov');
    expect(removeKnownMetadataFromTitle('Aperture 70h')).toBe('Aperture');
    expect(removeKnownMetadataFromTitle('Calcolo e Visualizzazione 80h')).toBe(
      'Calcolo e Visualizzazione',
    );
  });

  it('leaves clean titles untouched', () => {
    expect(removeKnownMetadataFromTitle('Strategia')).toBe('Strategia');
  });

  it('handles empty input safely', () => {
    expect(removeKnownMetadataFromTitle('')).toBe('');
  });
});
