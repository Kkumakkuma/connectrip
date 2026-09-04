// 오프라인 저장 단일 관문 (설계 §5.4).
//
// 플래너 코드는 `idb` 를 직접 import 하지 않는다. 반드시 이 모듈만 쓴다 —
// 저장 규칙(계정 키·만료·용량·삭제)이 한 곳에 모여 있어야 새는 곳이 안 생긴다.
//
// 무엇을 저장하나
//   · 여행 스냅샷: 자동. 비행기 안이나 로밍을 끈 상태에서 일정만이라도 보이게 한다.
//   · 티켓 원본: **여행별 opt-in, 기본 꺼짐.** 탑승권 바코드는 승객 성 + 예약번호 조합이라
//     여러 항공사에서 예약 조회·변경이 되는 자격증명이다. 기기에 사본을 남기는 건 사용자가 켤 때만.
//
// 언제 지우나
//   · 만료 = min(저장 후 30일, 여행 종료 +3일)
//   · 세션이 끊기면(로그아웃·토큰 만료·갱신 실패) DB 를 통째로 지운다
//   · 로그인하면 이전 계정 잔재와 만료분을 청소한다
//   · 여행·티켓을 지우면 그 사본도 지운다
//
// 계정 분리: 레코드 키에 항상 소유자 uid 가 들어간다. 계정별 DB 를 나누지 않는 이유는
// Firefox 가 indexedDB.databases() 를 지원하지 않아, 로그아웃이 한 번이라도 실패한 계정의
// DB 가 영구 고아가 되기 때문이다. 읽기는 늘 현재 uid 로만 하므로 혼입이 구조적으로 불가능하다.

// idb 는 정적으로 싣는다. 동적 import 로 두면 그 청크를 한 번도 받아 본 적 없는 상태로
// 비행기에 탔을 때, 정작 오프라인에서 여는 첫 순간에 청크를 못 받아 저장소가 통째로 죽는다
// (2026-09-04 교차검토 지적). 이 파일 자체가 플래너 청크 안에 있어 셸과 함께 캐시된다.
import { deleteDB, openDB } from 'idb';

const DB_NAME = 'ct-planner';
const DB_VERSION = 1;
const SNAPSHOTS = 'snapshots';
const TICKETS = 'tickets';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const AFTER_TRIP_MS = 3 * 24 * 60 * 60 * 1000;
const TICKET_QUOTA_BYTES = 60 * 1024 * 1024;
const QUOTA_USAGE_LIMIT = 0.9;

let dbPromise = null;

function supported() {
  return typeof indexedDB !== 'undefined';
}

async function db() {
  if (!supported()) return null;
  if (!dbPromise) {
    dbPromise = (async () => {
      return openDB(DB_NAME, DB_VERSION, {
        // 다른 탭이 DB 삭제를 시도하면 이 연결이 스스로 비켜 준다.
        // 안 그러면 그 탭의 삭제가 blocked 로 멈춘다.
        blocking() {
          try {
            this?.close?.();
          } catch {
            /* 무시 */
          }
          dbPromise = null;
        },
        upgrade(store) {
          if (!store.objectStoreNames.contains(SNAPSHOTS)) {
            store.createObjectStore(SNAPSHOTS, { keyPath: ['owner', 'tripId'] });
          }
          if (!store.objectStoreNames.contains(TICKETS)) {
            const s = store.createObjectStore(TICKETS, { keyPath: ['owner', 'ticketId'] });
            s.createIndex('byTrip', ['owner', 'tripId']);
          }
        },
      });
    })().catch(() => null);
  }
  return dbPromise;
}

// 만료 시각. 여행이 끝나고 3일이면 티켓도 스냅샷도 쓸 일이 없다.
function expiryFor(tripEndDate) {
  const base = Date.now() + THIRTY_DAYS_MS;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(tripEndDate || ''));
  if (!m) return base;
  const end = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) + AFTER_TRIP_MS;
  return Math.min(base, end);
}

// 저장 공간이 빠듯하면 아예 쓰지 않는다. 조용히 실패하면 사용자는 저장된 줄 안다.
async function hasRoom(extraBytes = 0) {
  try {
    const est = await navigator.storage?.estimate?.();
    if (!est || !est.quota) return true;   // 알 수 없으면 막지 않는다
    return (est.usage + extraBytes) / est.quota < QUOTA_USAGE_LIMIT;
  } catch {
    return true;
  }
}

export async function saveSnapshot(owner, tripId, snapshot, tripEndDate) {
  const conn = await db();
  if (!conn || !owner || !tripId) return false;
  if (!(await hasRoom())) return false;
  try {
    await conn.put(SNAPSHOTS, {
      owner,
      tripId,
      snapshot,
      savedAt: Date.now(),
      expiresAt: expiryFor(tripEndDate),
    });
    return true;
  } catch {
    return false;
  }
}

export async function readSnapshot(owner, tripId) {
  const conn = await db();
  if (!conn || !owner || !tripId) return null;
  try {
    const row = await conn.get(SNAPSHOTS, [owner, tripId]);
    if (!row) return null;
    if (row.expiresAt && row.expiresAt < Date.now()) {
      await conn.delete(SNAPSHOTS, [owner, tripId]);
      return null;
    }
    return row.snapshot;
  } catch {
    return null;
  }
}

/** 기기에 저장된 티켓 사본의 총 용량(바이트). */
export async function ticketBytes(owner) {
  const conn = await db();
  if (!conn || !owner) return 0;
  try {
    const rows = await conn.getAll(TICKETS);
    return rows
      .filter((r) => r.owner === owner)
      .reduce((sum, r) => sum + (r.blob?.size || 0), 0);
  } catch {
    return 0;
  }
}

/**
 * 티켓 원본을 기기에 저장한다(여행별 opt-in 을 호출부가 확인한 뒤 부른다).
 * @returns {'ok'|'no-room'|'quota'|'unsupported'|'error'}
 */
export async function saveTicket(owner, { tripId, ticketId, blob, mime, tripEndDate }) {
  const conn = await db();
  if (!conn) return 'unsupported';
  if (!owner || !ticketId || !blob) return 'error';
  const size = blob.size || 0;
  if ((await ticketBytes(owner)) + size > TICKET_QUOTA_BYTES) return 'quota';
  if (!(await hasRoom(size))) return 'no-room';
  try {
    await conn.put(TICKETS, {
      owner,
      ticketId,
      tripId,
      blob,
      mime,
      savedAt: Date.now(),
      expiresAt: expiryFor(tripEndDate),
    });
    return 'ok';
  } catch {
    return 'error';
  }
}

export async function readTicket(owner, ticketId) {
  const conn = await db();
  if (!conn || !owner || !ticketId) return null;
  try {
    const row = await conn.get(TICKETS, [owner, ticketId]);
    if (!row) return null;
    if (row.expiresAt && row.expiresAt < Date.now()) {
      await conn.delete(TICKETS, [owner, ticketId]);
      return null;
    }
    return row.blob;
  } catch {
    return null;
  }
}

export async function purgeTicket(owner, ticketId) {
  const conn = await db();
  if (!conn || !owner || !ticketId) return;
  try {
    await conn.delete(TICKETS, [owner, ticketId]);
  } catch {
    /* 무시 */
  }
}

export async function purgeTrip(owner, tripId) {
  const conn = await db();
  if (!conn || !owner || !tripId) return;
  try {
    await conn.delete(SNAPSHOTS, [owner, tripId]);
    const rows = await conn.getAll(TICKETS);
    await Promise.all(
      rows
        .filter((r) => r.owner === owner && r.tripId === tripId)
        .map((r) => conn.delete(TICKETS, [r.owner, r.ticketId])),
    );
  } catch {
    /* 무시 */
  }
}

/** 이전 계정 잔재 + 만료분 청소. 로그인 직후에 부른다. */
export async function sweep(owner) {
  const conn = await db();
  if (!conn) return;
  const now = Date.now();
  try {
    for (const store of [SNAPSHOTS, TICKETS]) {
      const rows = await conn.getAll(store);
      const keyOf = (r) => (store === SNAPSHOTS ? [r.owner, r.tripId] : [r.owner, r.ticketId]);
      await Promise.all(
        rows
          .filter((r) => r.owner !== owner || (r.expiresAt && r.expiresAt < now))
          .map((r) => conn.delete(store, keyOf(r))),
      );
    }
  } catch {
    /* 무시 */
  }
}

/**
 * 로그아웃 시 기기에 남은 사본을 지운다.
 *
 * IndexedDB 삭제는 같은 DB 를 연 다른 탭이 있으면 blocked 로 멈춘다. 그냥 던져 놓고
 * 잊으면 "지웠다고 생각했는데 티켓이 남아 있는" 상태가 된다(2026-09-04 교차검토 지적).
 * 그래서 두 겹으로 한다.
 *   1) 먼저 **내용을 비운다** — 이건 연결이 열려 있어도 성공한다. 민감한 데이터가 먼저 없어진다.
 *   2) 그다음 DB 자체를 지운다. blocked 면 5초만 기다리고 포기한다(내용은 이미 비었다).
 * @returns {'ok'|'cleared'|'failed'} cleared = 내용은 비웠지만 DB 껍데기는 남음
 */
export async function purgeAll() {
  if (!supported()) return 'ok';

  let cleared = false;
  try {
    const conn = await db();
    if (conn) {
      await Promise.all([conn.clear(SNAPSHOTS), conn.clear(TICKETS)]);
      cleared = true;
      conn.close?.();
    }
  } catch {
    /* 아래 삭제로 이어간다 */
  }
  dbPromise = null;

  try {
    await Promise.race([
      deleteDB(DB_NAME, {
        // 다른 탭이 붙잡고 있으면 여기로 온다. 알려만 주고 기다리지 않는다.
        blocked() {},
      }),
      new Promise((resolve) => setTimeout(resolve, 5000)),
    ]);
    return 'ok';
  } catch {
    return cleared ? 'cleared' : 'failed';
  }
}
