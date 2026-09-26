// 목록·검색·키워드 폴링은 서식 문서 칸(*_doc, 글 하나 최대 512KB)을 받지 않는다(설계 plan_v3 9장).
// 소스 글자를 읽어 막는다 — 누가 목록 조회를 '*' 로 되돌리면 여기서 걸린다.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// 작업 사본은 CRLF 일 수 있다(git autocrlf) — 줄끝을 맞춰 읽는다
const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const DB = read('../db.js');
const SEARCH = read('../../pages/Search.jsx');
const block = (src, start, end) => {
    const i = src.indexOf(start);
    const j = src.indexOf(end, i);
    if (i < 0 || j < 0) throw new Error(`구간 ${start} 없음`);
    return src.slice(i, j);
};

describe('목록 select 에 서식 문서 칸 없음', () => {
    it('목록 칸 상수는 명시 목록이고 * 도 _doc 도 없다', () => {
        const consts = [...DB.matchAll(/^const ([A-Z_]+_LIST_COLUMNS) = ['`]([^'`]+)['`];/gm)];
        expect(consts.map((m) => m[1]).sort()).toEqual([
            'COMPANION_LIST_COLUMNS', 'CREW_LIST_COLUMNS', 'DESTINATION_LIST_COLUMNS', 'QNA_LIST_COLUMNS', 'REVIEW_BODY_LIST_COLUMNS', 'REVIEW_LIST_COLUMNS',
        ]);
        for (const [, name, cols] of consts) {
            expect(cols, name).not.toContain('*');
            expect(cols, name).not.toMatch(/_doc\b/);
        }
    });
    it('게시판 목록 조회(getAll)가 목록 칸 상수를 쓴다', () => {
        expect(DB).toContain(".from('companion_posts')\n      .select(`${COMPANION_LIST_COLUMNS}, companion_comments(count)");
        expect(DB).toContain(".select(`${DESTINATION_LIST_COLUMNS}, destination_comments(count)");
        expect(DB).toContain('.select(withBody ? REVIEW_BODY_LIST_SELECT : REVIEW_LIST_SELECT)');
        expect(DB).toContain(".select(`${QNA_LIST_COLUMNS}, qna_comments(count)");
        expect(DB).toContain(".select(`${CREW_LIST_COLUMNS}, crew_comments(count)");
    });
    it('키워드 알림 폴링: 보드마다 select 를 적고 * 로 받지 않는다(추천지는 꿀팁 포함)', () => {
        const kb = block(DB, 'const KEYWORD_BOARDS = [', '\n];');
        const tables = [...kb.matchAll(/table: '([a-z_]+)'/g)].map((m) => m[1]);
        const selects = [...kb.matchAll(/select: '([^']+)'/g)].map((m) => m[1]);
        expect(tables).toHaveLength(selects.length);
        for (const s of selects) {
            expect(s).not.toContain('*');
            expect(s).not.toMatch(/_doc\b/);
        }
        expect(selects.find((s) => s.includes('crew_comment'))).toBe('id,created_at,name,description,crew_comment');
        expect(DB).toContain('.select(board.select)\n');
        expect(DB).not.toContain("board.select || '*'");
    });
    it('통합 검색: 6개 보드 + 일정 모두 select 명시, 추천지는 꿀팁도 검색', () => {
        const bs = block(SEARCH, 'const BOARDS = [', '\n];');
        const keys = [...bs.matchAll(/key: '([a-z_]+)'/g)].map((m) => m[1]);
        const selects = [...bs.matchAll(/select: '([^']+)'/g)].map((m) => m[1]);
        expect(keys).toHaveLength(7);
        expect(selects).toHaveLength(7);
        for (const s of selects) {
            expect(s).not.toContain('*');
            expect(s).not.toMatch(/_doc\b/);
        }
        expect(bs).toContain("fields: ['name', 'description', 'crew_comment']");
        expect(SEARCH).not.toContain("board.select || '*'");
        expect(SEARCH).not.toContain("'*, profiles");
    });
});
