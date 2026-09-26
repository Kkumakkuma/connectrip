import { useEffect, useState } from 'react';
import { resolveTripZoneAsync, zoneForCoords } from '../../lib/timezone';

/**
 * 장소 하나의 캘린더용 타임존. { ready, placeZone, tripZone }.
 *   placeZone = 좌표(tz-lookup) 타임존, tripZone = 여행 타임존(resolveTripZoneAsync — 티켓 화면과 같은 규칙).
 *   둘을 나눠 돌려준다: 좌표 없는 핀(0,0)은 placeEvent 가 placeZone 을 무시하고 tripZone 으로 되돌아가야 한다
 *   (하나로 합쳐 넘기면 여행 타임존까지 버려져 부동 시각이 나간다 — 교차검토 codex 지적).
 * 계산이 끝나기 전에는 ready=false — 그동안 링크를 그리지 않는다(아직 모르는 채로 부동 시각 링크가 나가지 않게).
 * 끝까지 모르면 ready=true·둘 다 null 이고, 그때는 .ics 와 같이 부동 시각 링크가 된다.
 */
export default function usePlaceZone(lat, lng, trip, places) {
  const [state, setState] = useState({ key: null, placeZone: null, tripZone: null });
  // 여행 타임존 결정에 쓰이는 값(저장된 타임존·장소 좌표 순서·목적지 좌표·나라)을 모두 키에 넣는다.
  const placesSig = (places || []).map((p) => `${p?.lat},${p?.lng}`).join(';');
  const key = [lat, lng, trip?.id, trip?.timezone, trip?.dest_lat, trip?.dest_lng, trip?.country, placesSig].join('|');
  useEffect(() => {
    let alive = true;
    (async () => {
      const [placeZone, tripZone] = await Promise.all([
        zoneForCoords(lat, lng).catch(() => null),
        resolveTripZoneAsync(trip, places || []).catch(() => null),
      ]);
      if (alive) setState({ key, placeZone, tripZone });
    })();
    return () => {
      alive = false;
    };
    // trip·places 객체는 저장할 때마다 새로 만들어진다. 결과를 바꾸는 값은 전부 key 에 들어 있다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const ready = state.key === key;
  return { ready, placeZone: ready ? state.placeZone : null, tripZone: ready ? state.tripZone : null };
}
