// 화면(doc.js)과 서버(rich_body_20260926.sql)가 같은 문서에 같은 답을 내는지 — 표본 문서(__fixtures__/docs.json)를
// 운영 DB 리허설(BEGIN…ROLLBACK)에서 SQL 함수에 넣은 결과(__fixtures__/sql_results.json)와 대조한다.
// 표본을 더하면 SQL 결과도 다시 기록해야 한다(아래 "모든 표본에 SQL 결과가 있다"가 막는다).
import { describe, expect, it } from 'vitest';
import docs from './__fixtures__/docs.json';
import sql from './__fixtures__/sql_results.json';
import { docImages, docToPlain, jsonbTextBytes, validateDoc } from './doc';

describe('JS ↔ SQL 동등성(표본 문서)', () => {
    it('모든 표본에 SQL 결과가 있다', () => {
        expect(sql.owner).toBe(docs.owner);
        for (const c of docs.cases) expect(sql.results[c.name], c.name).toBeTruthy();
        expect(Object.keys(sql.results).length).toBe(docs.cases.length);
    });

    for (const c of docs.cases) {
        it(c.name, () => {
            const want = sql.results[c.name];
            // 평문 파생 = rich_doc_plain
            expect(docToPlain(c.doc)).toBe(want.plain);
            // 바이트 = octet_length(doc::text)
            expect(jsonbTextBytes(c.doc)).toBe(want.bytes);
            // 사진 목록(검증 없이) = rich_doc_images
            expect(docImages(c.doc)).toEqual(want.images);
            // 검증 = rich_doc_check(doc, mode, owner) — 통과/거부와 사유 코드까지 같다
            const r = validateDoc(c.doc, { mode: c.mode, ownerId: docs.owner });
            expect(r.ok).toBe(want.ok);
            if (want.ok) {
                expect(r.images).toEqual(want.images);
                expect(r.media).toBe(want.media);
            } else {
                expect(r.reason).toBe(want.reason);
            }
        });
    }
});
