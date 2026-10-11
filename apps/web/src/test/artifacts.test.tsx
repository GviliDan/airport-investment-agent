import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ArtifactSchema } from '@airport/shared';
import { ArtifactList } from '../components/artifacts/ArtifactList';
import { congestion, demandPressure, INTERPRETATION, LONG_HAUL_NOTICE, longHaul, PRESSURE, profile, ranking, SCOPE } from './fixtures';

describe('fixtures', () => {
  it('are valid artifacts', () => {
    for (const a of [ranking(), congestion(), longHaul(), demandPressure(), profile(), ]) expect(ArtifactSchema.safeParse(a).success).toBe(true);
  });
});

const rankingRows = () => within(screen.getByRole('table', { name: /ordered by terminal expansion/i })).getAllByRole('row').slice(1);
const rankOf = (row: HTMLElement) => within(row).getAllByRole('rowheader')[0]?.textContent;

describe('ranking', () => {
  it('lists airports in exactly the artifact order with the artifact scores and the exact scope notice', () => {
    render(<ArtifactList artifacts={[ranking(3)]} />);
    const rows = rankingRows();
    expect(rows.map(rankOf)).toEqual(['1', '2', '3']);
    expect(rows[0]?.textContent).toContain('HVN');
    expect(rows[0]?.textContent).toContain('72.81');
    expect(rows[1]?.textContent).toContain('BOS');
    expect(rows[1]?.textContent).toContain('20,983,745');
    expect(screen.getByText(SCOPE)).toBeTruthy();
    expect(screen.getByText(INTERPRETATION)).toBeTruthy();
    expect(screen.getAllByText(/May 2025/).length).toBeGreaterThan(0);
  });

  it('shows missing factors as unavailable, never zero', () => {
    render(<ArtifactList artifacts={[ranking(3)]} />);
    const hvnRow = rankingRows()[0];
    expect(hvnRow?.textContent).toContain('Unavailable');
    expect(hvnRow?.textContent).toContain('−2.13%'); // negative values keep their sign
  });

  it('shows the first 10 and reveals the rest on request, preserving order', () => {
    render(<ArtifactList artifacts={[ranking(13)]} />);
    expect(rankingRows()).toHaveLength(10);
    fireEvent.click(screen.getByRole('button', { name: /Show remaining 3/ }));
    const ranks = rankingRows().map(rankOf);
    expect(ranks).toEqual(Array.from({ length: 13 }, (_, i) => String(i + 1)));
  });

  it('shows the scope notice exactly once', () => {
    render(<ArtifactList artifacts={[ranking(3)]} />);
    expect(screen.getAllByText(SCOPE)).toHaveLength(1);
  });
});

describe('congestion comparison', () => {
  it('declares no winner when winnerSupported is false', () => {
    render(<ArtifactList artifacts={[congestion()]} />);
    expect(screen.getByText(/Inconclusive comparison/)).toBeTruthy();
    expect(screen.getByText(/Do not name a winner/)).toBeTruthy();
    expect(screen.queryByText(/higher delays than/i)).toBeNull();
    expect(document.querySelector('.outcome')?.getAttribute('data-directional')).toBe('false');
  });

  it('shows requested and observed windows, covered hours and partial coverage', () => {
    render(<ArtifactList artifacts={[congestion()]} />);
    expect(screen.getAllByText(/2026-10-07 14:27/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/19:15 .* UTC/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('14 h').length).toBe(2);
    expect(screen.getByText(/SNA: departure median delay: 3 of 7 windows/)).toBeTruthy();
    expect(screen.getAllByText('4.1 min').length).toBeGreaterThan(0);
  });

  it('presents a directional outcome only when the artifact supports one', () => {
    render(
      <ArtifactList
        artifacts={[congestion({ comparisonOutcome: 'airport-a-higher-delay-pressure', winnerSupported: true, outcomeReading: 'LAX shows higher delays than SNA in every direction with complete data.' })]}
      />,
    );
    expect(screen.getByText(/LAX shows higher delays than SNA/)).toBeTruthy();
    expect(screen.queryByText(/Inconclusive/)).toBeNull();
  });
});

describe('long-haul', () => {
  it('shows share, threshold, flights, bands and the canonical caveat in view', () => {
    render(<ArtifactList artifacts={[longHaul()]} />);
    expect(screen.getAllByText('19.3%').length).toBeGreaterThan(0);
    expect(screen.getByText(/3,000 statute miles/)).toBeTruthy();
    expect(screen.getAllByText('12.5').length).toBeGreaterThan(0);
    expect(screen.getByText('64.8')).toBeTruthy();
    expect(screen.getByText('Under 1,000 miles')).toBeTruthy();
    expect(screen.getAllByText(LONG_HAUL_NOTICE)).toHaveLength(1);
    expect(screen.getByText(/rolling 7-day average/)).toBeTruthy();
  });
});

describe('demand pressure', () => {
  it('shows the exact notice prominently, the interpretation and unavailable components', () => {
    render(<ArtifactList artifacts={[demandPressure()]} />);
    expect(screen.getAllByText(PRESSURE)).toHaveLength(1);
    expect(screen.getByText('57.6')).toBeTruthy();
    expect(screen.getByText('Elevated')).toBeTruthy();
    expect(screen.getByText('Seat capacity grew slightly faster than passenger activity.')).toBeTruthy();
    expect(screen.getByText(/Unavailable: no departure data/)).toBeTruthy();
    expect(screen.getByText('−0.02 pp')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/unmet passengers|lost passengers|airport at capacity|\bat capacity/i);
  });
});

describe('airport profile and notices', () => {
  it('shows missing values as unavailable, not zero', () => {
    render(<ArtifactList artifacts={[profile()]} />);
    const seats = screen.getByText('Seats').parentElement;
    expect(seats?.textContent).toContain('Unavailable');
    expect(screen.getByText('36,590,656')).toBeTruthy();
    expect(screen.getByText('−3.29%')).toBeTruthy();
    expect(screen.getByText('0%')).toBeTruthy(); // a real zero stays zero
  });

  it('degrades gracefully for unknown artifacts', () => {
    render(<ArtifactList artifacts={[{ type: 'unsupported', originalType: 'future-thing' }]} />);
    expect(screen.getByText(/could not be displayed/)).toBeTruthy();
  });
});
