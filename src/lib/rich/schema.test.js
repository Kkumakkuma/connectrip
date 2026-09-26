// schema.js(화면 규칙의 단일 원천) ↔ SQL(rich_body_20260926.sql) 값 대조. 한쪽만 바꾸면 여기서 걸린다.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    ALIGNS, ALLOWED_NODES, BG_COLORS, BOARD_MEDIA, COLORS, FONT_SIZES, FONT_TOKENS, GALLERY_LAYOUTS, LIMITS,
    PUBLIC_IMAGE_PREFIX, RE, RE_SRC, TABLE_MEDIA, WS_CODEPOINTS,
} from './schema';
import { IMAGES_MAX } from '../postLimits';
import { BOARDS } from '../boards';

const SQL = readFileSync(new URL('../rich_body_20260926.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const ROLLBACK = readFileSync(new URL('../rich_body_rollback_20260926.sql', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const PRIVATE_SQL = readFileSync(new URL('../images_private_cleanup_20260926.sql', import.meta.url), 'utf8');

const constant = (name) => {
    const m = new RegExp(`^\\s*${name}\\s+CONSTANT\\s+\\S+\\s*:=\\s*(.+);`, 'm').exec(SQL);
    if (!m) throw new Error(`SQL 상수 ${name} 없음`);
    return m[1].trim();
};
const intConst = (name) => Number(constant(name).replace(/--.*$/, '').trim());
const textConst = (name) => {
    const v = constant(name);
    const m = /^'(.*)'$/.exec(v);
    if (!m) throw new Error(`SQL 문자열 상수 ${name} 형식`);
    return m[1];
};
const arrayConst = (name) => {
    const m = /^ARRAY\[(.*)\]$/.exec(constant(name));
    if (!m) throw new Error(`SQL 배열 상수 ${name} 형식`);
    return m[1].split(',').map((x) => x.trim()).map((x) => (x.startsWith("'") ? x.slice(1, -1) : Number(x)));
};

describe('schema.js ↔ SQL 값 대조', () => {
    it('한도', () => {
        expect(intConst('c_doc_bytes')).toBe(LIMITS.docBytes);
        expect(intConst('c_nodes')).toBe(LIMITS.nodes);
        expect(intConst('c_depth')).toBe(LIMITS.depth);
        expect(intConst('c_text_chars')).toBe(LIMITS.textChars);
        expect(intConst('c_marks')).toBe(LIMITS.marks);
        expect(intConst('c_images')).toBe(LIMITS.images);
        expect(intConst('c_gallery_min')).toBe(LIMITS.galleryMin);
        expect(intConst('c_gallery_max')).toBe(LIMITS.galleryMax);
        expect(intConst('c_maps')).toBe(LIMITS.maps);
        expect(intConst('c_href_max')).toBe(LIMITS.hrefMax);
        expect(intConst('c_map_name_max')).toBe(LIMITS.mapNameMax);
        expect(intConst('c_map_address_max')).toBe(LIMITS.mapAddressMax);
        expect(intConst('c_map_url_max')).toBe(LIMITS.mapUrlMax);
        expect(intConst('c_place_id_min')).toBe(LIMITS.placeIdMin);
        expect(intConst('c_place_id_max')).toBe(LIMITS.placeIdMax);
        expect(intConst('c_ordered_start_max')).toBe(LIMITS.orderedStartMax);
        expect(intConst('c_images_max')).toBe(IMAGES_MAX);         // post_body_guard 옛 글 분기
        expect(LIMITS.images).toBe(IMAGES_MAX);
    });

    it('문서 칸 CHECK 5개 = 문서 바이트 한도, 원고 한도 540,672', () => {
        const checks = SQL.match(/octet_length\((description_doc|content_doc|crew_comment_doc)::text\) <= (\d+)/g) || [];
        expect(checks).toHaveLength(5);
        for (const c of checks) expect(c.endsWith(`<= ${LIMITS.docBytes}`)).toBe(true);
        expect(SQL).toMatch(/octet_length\(data::text\) <= 540672/);
    });

    it('토큰(글꼴·크기·색·배경색·정렬·묶음 배치)', () => {
        expect(arrayConst('c_fonts')).toEqual([...FONT_TOKENS]);
        expect(arrayConst('c_sizes')).toEqual([...FONT_SIZES]);
        expect(arrayConst('c_colors')).toEqual([...COLORS]);
        expect(arrayConst('c_bg_colors')).toEqual([...BG_COLORS]);
        expect(arrayConst('c_aligns')).toEqual([...ALIGNS]);
        expect(arrayConst('c_layouts')).toEqual([...GALLERY_LAYOUTS]);
    });

    it('정규식 원문이 글자까지 같다', () => {
        expect(textConst('c_re_ctrl')).toBe(RE_SRC.ctrl);
        expect(textConst('c_re_ctrl_line')).toBe(RE_SRC.ctrlLine);
        expect(textConst('c_re_href')).toBe(RE_SRC.href);
        expect(textConst('c_re_map_url')).toBe(RE_SRC.mapUrl);
        expect(textConst('c_re_place_id')).toBe(RE_SRC.placeId);
        // 사진 참조: 비공개 참조 정규식(post_image_ref_ok)·공개 파일 이름 정규식(post_public_image_ok)
        expect(PRIVATE_SQL).toContain(`p_ref ~ '${RE_SRC.privateRef}'`);
        expect(SQL).toContain(`~ '${RE_SRC.fileName}'`);
        // PostgreSQL 정규식 반복 상한(255)을 넘는 {m,n} 을 쓰지 않는다(9/26 리허설에서 place ID {10,300} 이 오류를 냈다)
        for (const src of Object.values(RE_SRC)) {
            for (const [, a, b] of src.matchAll(/\{(\d+)(?:,(\d+))?\}/g)) {
                expect(Number(b ?? a)).toBeLessThanOrEqual(255);
            }
        }
    });

    it('빈 글 공백 문자: SQL chr 목록 = WS_CODEPOINTS = JS 정규식 공백(\\s) 집합', () => {
        const m = /c_ws_chars CONSTANT text := ([^;]*);/.exec(SQL);
        expect(m).toBeTruthy();
        const sqlCps = [...m[1].matchAll(/chr\((\d+)\)/g)].map((x) => Number(x[1]));
        expect(sqlCps).toEqual([...WS_CODEPOINTS]);
        expect(SQL).toContain("IF translate(v_plain, c_ws_chars, '') = '' AND v_media = 0 THEN");
        for (let cp = 0; cp <= 0xffff; cp += 1) {
            if (cp >= 0xd800 && cp <= 0xdfff) continue;
            const ch = String.fromCharCode(cp);
            expect(RE.wsOnly.test(ch), cp.toString(16)).toBe(/\s/.test(ch));
        }
    });

    it('추천지 공개 사진 주소 접두사 = VITE_SUPABASE_URL 기준', () => {
        expect(SQL).toContain(`'${PUBLIC_IMAGE_PREFIX}'::text AS prefix`);
    });

    it('file 노드는 4단계 전까지 허용 목록 밖(화면)·서버도 거부', () => {
        expect(ALLOWED_NODES).not.toContain('file');
        expect(SQL).toMatch(/WHEN 'file' THEN\s*\n\s*--[^\n]*\n\s*RAISE EXCEPTION 'BAD_BODY_DOC' USING DETAIL = 'FILE_NOT_ENABLED'/);
    });

    it('테이블별 사진 규칙(post_body_guard) = TABLE_MEDIA', () => {
        const seen = {};
        for (const m of SQL.matchAll(/v_tbl = '([a-z_]+)' THEN\s*\n\s*v_mode := '([a-z]+)'/g)) seen[m[1]] = m[2];
        const m2 = /v_tbl IN \('qna_posts', 'companion_posts'\) THEN\s*\n\s*v_mode := '([a-z]+)'/.exec(SQL);
        seen.qna_posts = m2[1];
        seen.companion_posts = m2[1];
        expect(seen).toEqual({ ...TABLE_MEDIA });
    });

    it('게시판 설정(boards.js)의 사진 규칙 = BOARD_MEDIA, 문서·평문 칸이 트리거 칸 목록에 있다', () => {
        const TABLE = { companion: 'companion_posts', review: 'reviews', qna: 'qna_posts', free: 'qna_posts', crew: 'crew_posts', destination: 'destinations' };
        for (const [key, cfg] of Object.entries(BOARDS)) {
            expect(cfg.media, key).toBe(BOARD_MEDIA[key]);
            expect(TABLE_MEDIA[TABLE[key]], key).toBe(BOARD_MEDIA[key]);
            const docCol = cfg.docField || cfg.extraDocField;
            const plainCol = cfg.docField ? cfg.bodyField : cfg.extraField;
            const trg = new RegExp(`UPDATE OF user_id, ${plainCol}, ${docCol}[^\\n]* ON public\\.${TABLE[key]}\\n`).exec(SQL);
            expect(trg, `${key} 트리거`).toBeTruthy();
        }
    });

    it('옛 사진 트리거는 없애고, 롤백(R0 주석·R2 파일)은 images_followup 과 같은 인자로 되살린다', () => {
        for (const t of ['reviews', 'crew_posts', 'destinations']) {
            expect(SQL).toContain(`DROP TRIGGER IF EXISTS trg_post_images ON public.${t};`);
        }
        const recreate = [
            "ON public.reviews\n  FOR EACH ROW EXECUTE FUNCTION public.trg_post_images('20', 'private');",
            "ON public.crew_posts\n  FOR EACH ROW EXECUTE FUNCTION public.trg_post_images('20', 'private');",
            "ON public.destinations\n  FOR EACH ROW EXECUTE FUNCTION public.trg_post_images('20', 'public');",
        ];
        for (const r of recreate) expect(ROLLBACK).toContain(r);
        // R2 는 잠금이 첫 동작이다(v3.1 8장)
        const body = ROLLBACK.slice(ROLLBACK.indexOf('BEGIN;'));
        const firstStmt = body.split('\n').find((l) => l.trim() && !l.startsWith('--') && l.trim() !== 'BEGIN;' && !l.startsWith('SET LOCAL'));
        expect(firstStmt).toMatch(/^LOCK TABLE public\.reviews, public\.crew_posts, public\.destinations, public\.qna_posts, public\.companion_posts, public\.post_drafts/);
    });
});
