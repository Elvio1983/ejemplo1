"""Minimal structural HTML check; intentionally not a full HTML5 validator."""

from collections import Counter
from html.parser import HTMLParser
from pathlib import Path
import sys

VOID = set("area base br col embed hr img input link meta param source track wbr".split())


class StructuralHTMLParser(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.stack = []
        self.ids = set()
        self.counts = Counter()
        self.errors = []
        self.doctypes = 0

    def error(self, message):
        line, col = self.getpos()
        self.errors.append(f"{line}:{col + 1}: {message}")

    def handle_decl(self, decl):
        if decl.lower() != "doctype html":
            self.error(f"Expected <!DOCTYPE html>, got <!{decl}>")
        self.doctypes += 1

    def handle_starttag(self, tag, attrs):
        self.counts[tag] += 1
        names = [name for name, _ in attrs]
        for name, count in Counter(names).items():
            if count > 1:
                self.error(f"Duplicate attribute {name!r} on <{tag}>")
        for name, value in attrs:
            if name == "id":
                if not value or value in self.ids:
                    self.error(f"Empty or duplicate id: {value!r}")
                self.ids.add(value)
        expected_parent = {"html": None, "head": "html", "body": "html"}
        if tag in expected_parent:
            parent = self.stack[-1] if self.stack else None
            if parent != expected_parent[tag]:
                self.error(f"Unexpected parent {parent!r} for <{tag}>")
        if tag not in VOID:
            self.stack.append(tag)

    def handle_startendtag(self, tag, attrs):
        self.handle_starttag(tag, attrs)
        if tag not in VOID:
            self.error(f"Non-void <{tag}> must have an explicit closing tag")
            self.handle_endtag(tag)

    def handle_endtag(self, tag):
        if tag in VOID:
            self.error(f"Void <{tag}> cannot have a closing tag")
        elif not self.stack or self.stack[-1] != tag:
            self.error(f"Unexpected </{tag}>; open tags: {self.stack}")
        else:
            self.stack.pop()

    def handle_data(self, data):
        if self.stack and self.stack[-1] in {"script", "style"}:
            return
        if "<" in data:
            self.error("Unparsed '<' in text; check markup or use &lt;")
        if data.strip() and not self.stack:
            self.error("Text outside <html>")

    def finish(self):
        self.close()
        if self.rawdata.strip():
            self.error("Incomplete markup at end of file")
        if self.stack:
            self.error(f"Unclosed tags: {self.stack}")
        if self.doctypes != 1:
            self.error("Exactly one <!DOCTYPE html> is required")
        for tag in ("html", "head", "body", "title"):
            if self.counts[tag] != 1:
                self.error(f"Exactly one <{tag}> is required")


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python3 scripts/check-html.py index.html")
    path = Path(sys.argv[1])
    parser = StructuralHTMLParser()
    parser.feed(path.read_text(encoding="utf-8"))
    parser.finish()
    if parser.errors:
        for error in parser.errors:
            print(f"{path}:{error}", file=sys.stderr)
        return 1
    print(f"HTML structure OK: {path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
