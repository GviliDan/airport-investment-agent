import type { ReactNode } from 'react';
import type { Artifact } from '@airport/shared';
import { formatPeriod } from '../../lib/format';

type Source = Artifact['sources'][number];

export type FactKind = 'Data period' | 'Assumption' | 'Limitation' | 'Confidence';
export interface Fact {
  kind: FactKind;
  text: string;
}

export function ArtifactCard({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <section className="artifact" aria-label={title}>
      <header className="artifact-head">
        <h3>{title}</h3>
        {subtitle ? <p className="muted">{subtitle}</p> : null}
      </header>
      {children}
    </section>
  );
}

/** Caveats the reader must see: always visible, never behind hover or a collapsed section. */
export function Facts({ facts }: { facts: Fact[] }) {
  if (facts.length === 0) return null;
  return (
    <dl className="facts">
      {facts.map((fact, index) => (
        <div key={`${fact.kind}-${index}`} className="fact">
          <dt data-kind={fact.kind}>{fact.kind}</dt>
          <dd>{fact.text}</dd>
        </div>
      ))}
    </dl>
  );
}

export const assumptionFacts = (assumptions: readonly string[]): Fact[] => assumptions.map((text) => ({ kind: 'Assumption', text }));

export function NoticePanel({ title, children, tone = 'info' }: { title?: string; children: ReactNode; tone?: 'info' | 'warning' | 'strong' }) {
  return (
    <aside className="notice" data-tone={tone}>
      {title ? <strong>{title}</strong> : null}
      <p>{children}</p>
    </aside>
  );
}

export function Sources({ sources }: { sources: readonly Source[] }) {
  if (sources.length === 0) return null;
  return (
    <details className="sources">
      <summary>Data sources</summary>
      <ul>
        {sources.map((s, index) => (
          <li key={`${s.source}-${s.dataset}-${index}`}>
            {s.source} · {s.dataset}
            {s.period ? ` · ${formatPeriod(s.period)}` : ''} · retrieved {s.retrievedAt.slice(0, 10)}
          </li>
        ))}
      </ul>
    </details>
  );
}

export function Bar({ percent, label }: { percent: number | null; label: string }) {
  if (percent == null) return null;
  const width = Math.max(0, Math.min(100, percent));
  return (
    <span className="bar" role="img" aria-label={label}>
      <span style={{ width: `${width}%` }} />
    </span>
  );
}

export function AirportName({ airport }: { airport: { code: string; name: string; city: string; state: string } }) {
  return (
    <span className="airport">
      <strong>{airport.code}</strong>
      <span className="airport-name">
        {airport.name} &middot; {airport.city}, {airport.state}
      </span>
    </span>
  );
}
