/**
 * 极简 Markdown → HTML（文档站用，渲染 references/*.md）。
 * 支持：标题（带 id）、段落、无序/有序列表（两级）、引用、围栏代码、GFM 表格、分隔线、
 * 行内 code / 粗体 / 斜体 / 链接 / 图片。HTML 一律转义。
 * Browser: window.MapStageMd   Node: module.exports
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.MapStageMd = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function slug(text) {
    return String(text)
      .toLowerCase()
      .replace(/<[^>]+>/g, '')
      .replace(/[`*_~]/g, '')
      .replace(/[^\w一-鿿\- ]+/g, '')
      .trim()
      .replace(/\s+/g, '-');
  }

  function inline(src, opts) {
    var codes = [];
    var s = String(src).replace(/`([^`]+)`/g, function (_, c) {
      codes.push('<code>' + esc(c) + '</code>');
      return '\u0000' + (codes.length - 1) + '\u0000';
    });
    s = esc(s);
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, function (_, alt, href) {
      return '<img src="' + href + '" alt="' + alt + '" loading="lazy">';
    });
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (_, label, href) {
      var h = opts && opts.link ? opts.link(href.replace(/&amp;/g, '&')) : href;
      var ext = /^https?:/i.test(h) ? ' target="_blank" rel="noopener"' : '';
      return '<a href="' + esc(h) + '"' + ext + '>' + label + '</a>';
    });
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*\w])\*([^*\s][^*]*)\*(?!\w)/g, '$1<em>$2</em>');
    s = s.replace(/\u0000(\d+)\u0000/g, function (_, i) { return codes[Number(i)]; });
    return s;
  }

  function splitRow(line) {
    var t = line.trim().replace(/^\|/, '').replace(/\|$/, '');
    var cells = [];
    var cur = '';
    var inCode = false;
    for (var i = 0; i < t.length; i++) {
      var ch = t[i];
      if (ch === '`') inCode = !inCode;
      if (ch === '\\' && t[i + 1] === '|') { cur += '|'; i++; continue; }
      if (ch === '|' && !inCode) { cells.push(cur.trim()); cur = ''; continue; }
      cur += ch;
    }
    cells.push(cur.trim());
    return cells;
  }

  function isTableSep(line) {
    return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);
  }

  function render(md, opts) {
    opts = opts || {};
    var lines = String(md).replace(/\r\n?/g, '\n').split('\n');
    var out = [];
    var toc = [];
    var i = 0;
    var used = {};

    function heading(level, text) {
      var custom = text.match(/\s*\{#([\w-]+)\}\s*$/);
      if (custom) text = text.slice(0, custom.index);
      var base = custom ? custom[1] : slug(text) || 'sec';
      var id = base;
      var n = 2;
      while (used[id]) id = base + '-' + n++;
      used[id] = true;
      if (level <= 3) toc.push({ level: level, id: id, text: text.replace(/[`*]/g, '') });
      out.push('<h' + level + ' id="' + id + '">' + inline(text, opts) + '</h' + level + '>');
    }

    function itemBody(text) {
      var task = text.match(/^\[([ xX])\]\s+(.*)$/);
      if (task) return '<span class="task' + (task[1] === ' ' ? '' : ' done') + '"></span>' + inline(task[2], opts);
      return inline(text, opts);
    }

    function list(startIdx) {
      var items = [];
      var j = startIdx;
      while (j < lines.length) {
        var m = lines[j].match(/^(\s*)([-*]|\d+[.)])\s+(.*)$/);
        if (m) {
          items.push({ depth: Math.min(2, Math.floor(m[1].length / 2)), tag: /\d/.test(m[2]) ? 'ol' : 'ul', text: m[3] });
          j++;
        } else if (items.length && /^\s{2,}\S/.test(lines[j])) {
          items[items.length - 1].text += ' ' + lines[j].trim();
          j++;
        } else {
          break;
        }
      }
      var k = 0;
      function build(depth) {
        var tag = items[k].tag;
        var html = '<' + tag + '>';
        while (k < items.length && items[k].depth >= depth) {
          if (items[k].depth > depth) {
            if (/<\/li>$/.test(html)) html = html.slice(0, -5) + build(depth + 1) + '</li>';
            else html += '<li>' + build(depth + 1) + '</li>';
            continue;
          }
          html += '<li>' + itemBody(items[k].text) + '</li>';
          k++;
        }
        return html + '</' + tag + '>';
      }
      var parts = [];
      while (k < items.length) parts.push(build(items[k].depth));
      out.push(parts.join(''));
      return j;
    }

    while (i < lines.length) {
      var line = lines[i];
      if (!line.trim()) { i++; continue; }

      var fence = line.match(/^```\s*([\w-]*)/);
      if (fence) {
        var buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]);
        i++;
        var lang = fence[1] ? ' data-lang="' + esc(fence[1]) + '"' : '';
        out.push('<pre' + lang + '><code>' + esc(buf.join('\n')) + '</code></pre>');
        continue;
      }

      var h = line.match(/^(#{1,6})\s+(.*?)\s*#*\s*$/);
      if (h) { heading(h[1].length, h[2]); i++; continue; }

      if (/^\s*(---|\*\*\*|___)\s*$/.test(line)) { out.push('<hr>'); i++; continue; }

      if (/^\s*\|/.test(line) && i + 1 < lines.length && isTableSep(lines[i + 1])) {
        var head = splitRow(line);
        var aligns = splitRow(lines[i + 1]).map(function (c) {
          if (/^:-+:$/.test(c)) return 'center';
          if (/-+:$/.test(c)) return 'right';
          return '';
        });
        i += 2;
        var rows = [];
        while (i < lines.length && /^\s*\|/.test(lines[i])) rows.push(splitRow(lines[i++]));
        var t = ['<div class="table-wrap"><table><thead><tr>'];
        head.forEach(function (c, k) {
          t.push('<th' + (aligns[k] ? ' style="text-align:' + aligns[k] + '"' : '') + '>' + inline(c, opts) + '</th>');
        });
        t.push('</tr></thead><tbody>');
        rows.forEach(function (r) {
          t.push('<tr>');
          head.forEach(function (_, k) {
            t.push('<td' + (aligns[k] ? ' style="text-align:' + aligns[k] + '"' : '') + '>' + inline(r[k] || '', opts) + '</td>');
          });
          t.push('</tr>');
        });
        t.push('</tbody></table></div>');
        out.push(t.join(''));
        continue;
      }

      if (/^\s*>/.test(line)) {
        var q = [];
        while (i < lines.length && /^\s*>/.test(lines[i])) q.push(lines[i++].replace(/^\s*>\s?/, ''));
        out.push('<blockquote>' + render(q.join('\n'), opts).html + '</blockquote>');
        continue;
      }

      if (/^(\s*)([-*]|\d+[.)])\s+/.test(line)) { i = list(i); continue; }

      var para = [line.trim()];
      i++;
      while (
        i < lines.length && lines[i].trim() &&
        !/^(#{1,6}\s|```|\s*>|\s*([-*]|\d+[.)])\s+|\s*\|)/.test(lines[i]) &&
        !/^\s*(---|\*\*\*|___)\s*$/.test(lines[i])
      ) {
        para.push(lines[i].trim());
        i++;
      }
      out.push('<p>' + inline(para.join(' '), opts) + '</p>');
    }

    return { html: out.join('\n'), toc: toc };
  }

  /** 去掉 YAML front matter，返回 { meta, body } */
  function frontMatter(md) {
    var m = String(md).match(/^---\n([\s\S]*?)\n---\n?/);
    if (!m) return { meta: {}, body: String(md) };
    var meta = {};
    m[1].split('\n').forEach(function (l) {
      var kv = l.match(/^(\w[\w-]*):\s*(.*)$/);
      if (kv) meta[kv[1]] = kv[2].replace(/^['"]|['"]$/g, '');
    });
    return { meta: meta, body: String(md).slice(m[0].length) };
  }

  return { render: render, inline: inline, slug: slug, esc: esc, frontMatter: frontMatter };
});
