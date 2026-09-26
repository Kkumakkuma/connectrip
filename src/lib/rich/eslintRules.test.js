// eslint.config.js 의 금지 규칙이 실제로 오류를 내는지(서식 글 1단계, 설계 plan_v3 5-1·6-5·12-4)
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ESLint } from 'eslint';
import { beforeAll, describe, expect, it } from 'vitest';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
let eslint;
const lint = async (code, file = 'src/__lint_probe__.jsx') => {
    const [r] = await eslint.lintText(code, { filePath: path.join(ROOT, file) });
    return r.messages.map((m) => m.ruleId);
};

beforeAll(() => { eslint = new ESLint({ cwd: ROOT }); });

describe('ESLint 금지 규칙', () => {
    it('dangerouslySetInnerHTML 금지', async () => {
        const ids = await lint('export const X = ({ h }) => <div dangerouslySetInnerHTML={{ __html: h }} />;\n');
        expect(ids).toContain('no-restricted-syntax');
    }, 30000);
    it('DOMParser·parseFromString 금지', async () => {
        expect(await lint('export const a = new DOMParser();\n', 'src/__lint_probe__.js')).toContain('no-restricted-syntax');
        expect(await lint('export const a = new window.DOMParser();\n', 'src/__lint_probe__.js')).toContain('no-restricted-syntax');
        expect(await lint('export const a = (p, s) => p.parseFromString(s, "text/html");\n', 'src/__lint_probe__.js')).toContain('no-restricted-syntax');
    }, 30000);
    it('pdf.js 뷰어·샌드박스 import 금지(표시 API 는 허용)', async () => {
        expect(await lint("import { PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';\nexport default PDFViewer;\n", 'src/__lint_probe__.js')).toContain('no-restricted-imports');
        expect(await lint("import s from 'pdfjs-dist/build/pdf.sandbox.mjs';\nexport default s;\n", 'src/__lint_probe__.js')).toContain('no-restricted-imports');
        expect(await lint("import * as p from 'pdfjs-dist/legacy/build/pdf.mjs';\nexport default p;\n", 'src/__lint_probe__.js')).not.toContain('no-restricted-imports');
    }, 30000);
    it('legacy/web 경로·동적 import() 도 금지(codex 9/26), 지금 쓰는 표시 API·워커 import 는 허용', async () => {
        expect(await lint("import { PDFViewer } from 'pdfjs-dist/legacy/web/pdf_viewer.mjs';\nexport default PDFViewer;\n", 'src/__lint_probe__.js')).toContain('no-restricted-imports');
        expect(await lint("export const f = () => import('pdfjs-dist/build/pdf.sandbox.mjs');\n", 'src/__lint_probe__.js')).toContain('no-restricted-syntax');
        expect(await lint("export const f = () => import('pdfjs-dist/legacy/web/pdf_viewer.mjs');\n", 'src/__lint_probe__.js')).toContain('no-restricted-syntax');
        expect(await lint("export const f = () => import('pdfjs-dist/web/pdf_viewer.mjs');\n", 'src/__lint_probe__.js')).toContain('no-restricted-syntax');
        expect(await lint("export const f = () => import('pdfjs-dist');\nexport const g = () => import('pdfjs-dist/build/pdf.worker.min.mjs?url');\n", 'src/__lint_probe__.js')).toEqual([]);
    }, 30000);
    it('평범한 코드는 걸리지 않는다', async () => {
        expect(await lint('export const X = ({ t }) => <p>{t}</p>;\n')).toEqual([]);
    }, 30000);
});
