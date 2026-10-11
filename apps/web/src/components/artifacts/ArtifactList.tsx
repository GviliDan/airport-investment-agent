import type { RenderableArtifact } from '../../lib/chatClient';
import { CongestionView } from './CongestionView';
import { DemandPressureView } from './DemandPressureView';
import { LongHaulView } from './LongHaulView';
import { NoticePanel } from './parts';
import { ProfileView } from './ProfileView';
import { RankingView } from './RankingView';

function ArtifactView({ artifact }: { artifact: RenderableArtifact }) {
  switch (artifact.type) {
    case 'ranking':
      return <RankingView artifact={artifact} />;
    case 'long-haul':
      return <LongHaulView artifact={artifact} />;
    case 'congestion-comparison':
      return <CongestionView artifact={artifact} />;
    case 'demand-pressure':
      return <DemandPressureView artifact={artifact} />;
    case 'airport-profile':
      return <ProfileView artifact={artifact} />;
    default:
      return <NoticePanel tone="warning">One result could not be displayed because its type or shape is not supported. The written answer is still shown.</NoticePanel>;
  }
}

export function ArtifactList({ artifacts }: { artifacts: readonly RenderableArtifact[] }) {
  if (artifacts.length === 0) return null;
  return (
    <div className="artifacts">
      {artifacts.map((a, index) => (
        <ArtifactView key={`${a.type}-${index}`} artifact={a} />
      ))}
    </div>
  );
}
