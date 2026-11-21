import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownRenderer } from "../MarkdownRenderer";

function render(md: string): string {
  return renderToStaticMarkup(<MarkdownRenderer text={md} />);
}

function decodeHtml(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'");
}

describe("MarkdownRenderer", () => {
  it("renders the Karabiner uninstall screenshot markdown as a single 3-item ordered list with nested code blocks", () => {
    const md = [
      "1. **应用本体**（`/Applications` 需管理员权限）：",
      "   - 在 Finder 里手动拖 `Karabiner-Elements.app` 和 `Karabiner-EventViewer.app` 到废纸篓，或终端执行：",
      "     ```",
      "     sudo mv /Applications/Karabiner-Elements.app /Applications/Karabiner-EventViewer.app ~/.Trash/",
      "     ```",
      "2. **驱动残留（关键！）**——Ctrl+Space 漏键的根源就是这个：",
      "   ```",
      "   systemextensionsctl list",
      "   sudo systemextensionsctl uninstall org.pqrs org.pqrs.Karabiner-DriverKit-VirtualHIDDevice",
      "   ```",
      "3. **Containers 目录**（`Karabiner-VirtualHIDDevice-Manager`，很小、无影响）：终端需「完全磁盘访问权限」才能删，可忽略或之后手动清。",
    ].join("\n");

    const html = render(md);

    // Must render exactly 1 <ol> and 1 nested <ul>, with no invalid <li><li> nesting
    expect(html.match(/<ol\b/g) ?? []).toHaveLength(1);
    expect(html.match(/<ul\b/g) ?? []).toHaveLength(1);
    expect(html).not.toMatch(/<li\b[^>]*>\s*<li\b/);

    // Must render 2 CodeBlockCards (<pre><code>...</code></pre>) and zero literal backtick fences
    expect(html.match(/<pre\b/g) ?? []).toHaveLength(2);
    expect(html).not.toContain("```");

    // Must have 4 <li> elements total: 3 in <ol> + 1 in nested <ul>
    expect(html.match(/<li\b/g) ?? []).toHaveLength(4);

    // Non-task <li> elements must keep display: list-item (must not carry Tailwind flex class)
    expect(html).not.toMatch(/<li\b[^>]*class="[^"]*\bflex\b/);

    // Verify exact code block contents without stray indentation
    const preMatches = [...html.matchAll(/<pre[^>]*><code>([\s\S]*?)<\/code><\/pre>/g)].map(
      (m) => decodeHtml(m[1] ?? "")
    );
    expect(preMatches).toEqual([
      "sudo mv /Applications/Karabiner-Elements.app /Applications/Karabiner-EventViewer.app ~/.Trash/",
      "systemextensionsctl list\nsudo systemextensionsctl uninstall org.pqrs org.pqrs.Karabiner-DriverKit-VirtualHIDDevice",
    ]);

    // Verify item 3 bold label is preserved
    expect(html).toContain(">Containers 目录</strong>");
    expect(html).toContain(">驱动残留（关键！）</strong>");
  });

  it("renders surge-doctor SKILL.md fenced sh block inside unordered list item", () => {
    const md = [
      "#### 1. 导入与脱敏聚类（只读）",
      "- 运行插件内置脱敏脚本（`bash` 只读放行）：",
      "  ```sh",
      '  bun "${VALET_PLUGIN_DIR}/scripts/import-logs.mjs" --minutes=360',
      "  ```",
      '- 若用户指定自定义 `.log` 文件路径，附加 `--path="/path/to/file.log"`。',
    ].join("\n");

    const html = render(md);
    expect(html.match(/<ul\b/g) ?? []).toHaveLength(1);
    expect(html.match(/<li\b/g) ?? []).toHaveLength(2);
    expect(html.match(/<pre\b/g) ?? []).toHaveLength(1);
    expect(html).toContain(">sh</span>");
    expect(decodeHtml(html)).toContain(
      '<code>bun "${VALET_PLUGIN_DIR}/scripts/import-logs.mjs" --minutes=360</code>'
    );
  });

  it("preserves exact inner indentation for 2-space, 3-space, and 4-space indented Python fences in ordered lists", () => {
    for (const spaces of [2, 3, 4]) {
      const pad = " ".repeat(spaces);
      const md = [
        "1. Python example:",
        `${pad}\`\`\`python`,
        `${pad}def foo():`,
        `${pad}    return 1`,
        `${pad}\`\`\``,
        "2. Done",
      ].join("\n");

      const html = render(md);
      expect(html.match(/<ol\b/g) ?? []).toHaveLength(1);
      expect(html.match(/<li\b/g) ?? []).toHaveLength(2);
      const codeMatch = /<pre[^>]*><code>([\s\S]*?)<\/code><\/pre>/.exec(html);
      expect(decodeHtml(codeMatch?.[1] ?? "")).toBe("def foo():\n    return 1");
    }
  });

  it("supports blank lines inside list code fences and streaming unclosed fences", () => {
    const mdWithBlank = [
      "1. Multi-paragraph code:",
      "   ```bash",
      "   echo one",
      "",
      "   echo two",
      "   ```",
      "2. Next step",
    ].join("\n");

    const htmlBlank = render(mdWithBlank);
    expect(htmlBlank.match(/<ol\b/g) ?? []).toHaveLength(1);
    expect(htmlBlank.match(/<li\b/g) ?? []).toHaveLength(2);
    const codeMatch = /<pre[^>]*><code>([\s\S]*?)<\/code><\/pre>/.exec(htmlBlank);
    expect(decodeHtml(codeMatch?.[1] ?? "")).toBe("echo one\n\necho two");

    const streamingMd = [
      "1. Streaming command:",
      "   ```sh",
      "   echo streaming",
    ].join("\n");

    const htmlStream = render(streamingMd);
    expect(htmlStream.match(/<ol\b/g) ?? []).toHaveLength(1);
    expect(htmlStream.match(/<pre\b/g) ?? []).toHaveLength(1);
    expect(htmlStream).toContain("echo streaming");
  });

  it("keeps loose ordered lists in one <ol> and preserves start attribute when > 1", () => {
    const looseMd = ["1. First", "", "2. Second", "", "3. Third"].join("\n");
    const htmlLoose = render(looseMd);
    expect(htmlLoose.match(/<ol\b/g) ?? []).toHaveLength(1);
    expect(htmlLoose.match(/<li\b/g) ?? []).toHaveLength(3);

    const startTwoMd = ["2. Second item", "3. Third item"].join("\n");
    const htmlStart = render(startTwoMd);
    expect(htmlStart).toContain('<ol start="2"');
  });

  it("handles inline formatting, CJK punctuation, snake_case, code spans, escapes, links, tables, blockquotes, and tasks", () => {
    const md = [
      "**残留（`org.pqrs.*`）** 与 **重点（关键！）**内容",
      "",
      "标识符 Karabiner_Elements_App 和 org_pqrs_driver 不应斜体，而 ``code ` tick`` 与 \\*not italic\\* 正常。",
      "",
      "单行 ```inline_triple``` 不成块。",
      "",
      "访问 https://example.com/a_(b)，或 [**加粗链接**](https://en.wikipedia.org/wiki/Foo_(bar))。",
      "",
      "> 引用内列表：",
      "> 1. 第一项",
      "> 2. 第二项",
      "",
      "| 列A | 列B |",
      "| :--- | ---: |",
      "| `a | b` | 100 |",
      "",
      "- [x] 已完成",
      "- [ ] 待处理",
      "",
      "---",
      "* * *",
    ].join("\n");

    const html = render(md);

    // Inline bold + code + CJK adjacency
    expect(html).toContain(">残留（<code");
    expect(html).toContain(">org.pqrs.*</code>）</strong>");
    expect(html).toContain(">重点（关键！）</strong>内容");

    // No accidental italicization on snake_case or escaped stars
    expect(html).not.toContain("<em");
    expect(html).toContain("Karabiner_Elements_App");
    expect(html).toContain("org_pqrs_driver");
    expect(html).toContain("*not italic*");

    // Multi-backtick inline code & single-line triple-backtick inline code
    expect(decodeHtml(html)).toContain(">code ` tick</code>");
    expect(html).toContain(">inline_triple</code>");
    expect(html).not.toContain("<pre");

    // Links & autolinks with balanced parens and CJK punctuation trimming
    expect(html).toContain('href="https://example.com/a_(b)"');
    expect(html).toContain('href="https://en.wikipedia.org/wiki/Foo_(bar)"');
    expect(html).toContain(">加粗链接</strong></a>");

    // Blockquote containing ordered list
    expect(html).toContain("<blockquote");
    expect(html).toContain("<ol");

    // GFM table with escaped/code pipe
    expect(html).toContain("<table");
    expect(html).toContain(">a | b</code>");
    expect(html).toContain('text-align:right');

    // Task list
    expect(html).toContain(">✓</span>");

    // Horizontal rules not parsed as lists
    expect(html.match(/<hr\b/g) ?? []).toHaveLength(2);
    expect(html.match(/<ul\b/g) ?? []).toHaveLength(1);
  });

  it("handles nested bold/italic delimiters, strikethrough, and mixed task/non-task lists", () => {
    const md = [
      "***重点*** 与 ***bold** and italic* 以及 ~~已废弃~~",
      "",
      "- 普通条目",
      "- [x] 任务条目",
    ].join("\n");

    const html = render(md);
    expect(html).toContain("font-semibold italic");
    expect(html).toContain(">重点</strong>");
    expect(html).toContain("<em");
    expect(html).toContain(">bold</strong> and italic</em>");
    expect(html).toContain("<del");
    expect(html).toContain(">已废弃</del>");
    expect(html).toContain("-ml-4 flex list-none items-start gap-2");
    expect(html).toContain('class="pl-0.5">普通条目</li>');
  });

  it("renders multi-line user queries with fenced code blocks, single newlines, indentation, and inline triple-backtick commands", () => {
    const fencedUserQuery = [
      "账号是 root，密码是 example-pass，",
      "```",
      "ssh root@192.0.2.1 -p 22",
      "```",
      "你自己去排查下吧",
    ].join("\n");

    const fencedHtml = render(fencedUserQuery);
    expect(fencedHtml.match(/<p\b/g) ?? []).toHaveLength(2);
    expect(fencedHtml.match(/<pre\b/g) ?? []).toHaveLength(1);
    expect(fencedHtml).not.toContain("```");
    expect(decodeHtml(fencedHtml)).toContain("<code>ssh root@192.0.2.1 -p 22</code>");

    const jsonAndNewlines = [
      "{",
      '  "mcpServers": {',
      '    "tower": "https://example.com/mcp"',
      "  }",
      "}",
      "第一行",
      "第二行",
    ].join("\n");

    const plainHtml = render(jsonAndNewlines);
    expect(plainHtml).toContain('<p class="whitespace-pre-wrap break-words">');
    expect(plainHtml).toContain('href="https://example.com/mcp"');
    expect(decodeHtml(plainHtml).replace(/<[^>]+>/g, "")).toBe(
      '{\n  "mcpServers": {\n    "tower": "https://example.com/mcp"\n  }\n}\n第一行\n第二行'
    );

    const inlineTriple = "试试 ``` ssh root@192.0.2.1 -p 22 ``` 这条命令";
    const inlineHtml = render(inlineTriple);
    expect(inlineHtml).not.toContain("<pre");
    expect(inlineHtml).toContain("break-words");
    expect(decodeHtml(inlineHtml)).toContain(">ssh root@192.0.2.1 -p 22</code>");
  });
});
