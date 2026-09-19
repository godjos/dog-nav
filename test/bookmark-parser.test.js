const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const parser = require('../public/js/bookmark-parser');

const NETSCAPE = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<!-- This is an automatically generated file. -->
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Bookmarks</TITLE>
<H1>Bookmarks</H1>
<DL><p>
    <DT><A HREF="https://example.com/" ADD_DATE="1700000000">Example &amp; Co</A>
    <DT><H3 ADD_DATE="1700000001">Dev Tools</H3>
    <DL><p>
        <DT><A HREF="https://github.com/">GitHub</A>
        <DT><A HREF="javascript:alert(1)">bad</A>
        <DT><H3>Inner &lt;Folder&gt;</H3>
        <DL><p>
            <DT><A HREF='https://nested.example/path?q=1'>Nested "Site"</A>
        </DL><p>
    </DL><p>
    <DT><A HREF="https://nodesc.example/">no description</A>
</DL><p>`;

describe('bookmark parser: Netscape HTML', () => {
    it('parses folders, nesting, entities and skips unsafe URLs', () => {
        const result = parser.parse(NETSCAPE);
        assert.equal(result.format, 'html');
        assert.equal(result.error, undefined);
        // 顶层：2 个站点 + 1 个文件夹
        const flat = result.roots.filter(n => n.url).map(n => n.url);
        assert.deepEqual(flat, ['https://example.com/', 'https://nodesc.example/']);
        assert.equal(result.roots[0].title, 'Example & Co');
        const dev = result.roots.find(n => n.children);
        assert.equal(dev.title, 'Dev Tools');
        const devUrls = dev.children.filter(n => n.url).map(n => n.url);
        assert.deepEqual(devUrls, ['https://github.com/']);
        const inner = dev.children.find(n => n.children);
        assert.equal(inner.title, 'Inner <Folder>');
        assert.deepEqual(inner.children, [{ title: 'Nested "Site"', url: 'https://nested.example/path?q=1' }]);
        assert.equal(result.totalSites, 4);
    });

    it('accepts files without the DOCTYPE header', () => {
        const result = parser.parse('<DL><DT><A HREF="https://a.example/">A</A></DL>');
        assert.equal(result.format, 'html');
        assert.equal(result.totalSites, 1);
    });
});

describe('bookmark parser: Chrome/Firefox JSON', () => {
    it('parses Chrome roots format with nested folders', () => {
        const chrome = JSON.stringify({
            roots: {
                bookmark_bar: {
                    name: 'Bookmarks bar',
                    children: [
                        { name: 'Flat', url: 'https://flat.example/' },
                        { name: 'Folder', children: [{ name: 'Kid', url: 'https://kid.example/' }] },
                    ],
                },
            },
        });
        const result = parser.parse(chrome);
        assert.equal(result.format, 'json');
        assert.equal(result.totalSites, 2);
        const bar = result.roots[0];
        assert.equal(bar.title, 'Bookmarks bar');
        assert.equal(bar.children[0].url, 'https://flat.example/');
        assert.equal(bar.children[1].children[0].url, 'https://kid.example/');
    });

    it('parses a plain array of nodes', () => {
        const result = parser.parse(JSON.stringify([
            { title: 'One', url: 'https://one.example/' },
            { title: 'Folder', children: [{ title: 'Two', url: 'https://two.example/' }] },
        ]));
        assert.equal(result.totalSites, 2);
        assert.equal(result.roots[1].children[0].url, 'https://two.example/');
    });

    it('drops nodes with unsafe or empty URLs', () => {
        const result = parser.parse(JSON.stringify([
            { title: 'ok', url: 'https://ok.example/' },
            { title: 'js', url: 'javascript:void(0)' },
            { title: 'empty', url: '   ' },
        ]));
        assert.equal(result.totalSites, 1);
    });
});

describe('bookmark parser: errors', () => {
    it('reports empty / unsupported / broken JSON input', () => {
        assert.equal(parser.parse('').error, 'empty');
        assert.equal(parser.parse('   ').error, 'empty');
        assert.equal(parser.parse('hello world, no bookmarks here').error, 'unsupported');
        assert.equal(parser.parse('{broken json').error, 'json');
    });
});
