#!/usr/bin/env python3
"""Bakes the Bulgarian `locl` letterforms into the print kit's Cyrillic fonts.

WHY. Bulgarian Cyrillic draws a dozen letters differently from Russian
(д, л, г, т, ж, в, з, и, й, к, п, ц, ш, щ, ю, ф ...), and the fonts carry those forms
in a `locl` feature that only the language system `BGR ` switches on. A browser
selects it from `lang="bg"`. The PDF cannot: PDFKit hands fontkit the text and
no language, so the default forms print. The print kit sets Cyrillic for one
language only (bg is the only Cyrillic guest locale, see guest-locale.ts), so
the forms are frozen into the files: the cmap is pointed at the Bulgarian glyph
the `BGR ` lookups would have chosen. The shaping then needs no language at
run time and nothing in PDFKit's or fontkit's internals.

WHAT. For each Cyrillic subset in SOURCES, reads the guest woff2 (the file the
browser is served), applies the `locl` lookups of the `cyrl` / `BGR ` language
system to the cmap, and writes TrueType into the print kit's `fonts/`
directory, which is the same lossless woff2-to-TrueType conversion
`print-kit-fonts.ts` describes (fontkit mis-reads woff2's transformed `glyf`
table) plus the frozen forms. The GSUB table is left as it was. Only the base
`cyrillic` subsets are frozen: Bulgarian's alphabet is U+0400..U+045F, and the
`cyrillic-ext` subsets hold other languages' letters.

RUN. `python3 scripts/fonts/freeze-bg-locl.py` from the repository root, with
fontTools and brotli installed (`pip install fonttools brotli`). The output is
deterministic (no timestamp is rewritten), and the script fails if a source has
no Bulgarian forms to freeze, so a font update that drops them is noticed.
`print-kit-fonts.test.ts` checks the shipped files against the glyph names.
"""

from pathlib import Path

from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parents[2]
GUEST_FONTS = ROOT / "public" / "fonts" / "guest"
PRINT_KIT_FONTS = (
    ROOT / "src" / "contexts" / "portal" / "infrastructure" / "print-kit" / "fonts"
)

SOURCES = (
    "cormorant-garamond-cyrillic-600-normal",
    "ysabeau-office-cyrillic-400-normal",
    "ysabeau-office-cyrillic-600-normal",
)

SCRIPT = "cyrl"
LANGUAGE = "BGR "
FEATURE = "locl"
SINGLE_SUBSTITUTION = 1
EXTENSION_SUBSTITUTION = 7


def single_substitutions(lookup):
    """The glyph-to-glyph maps of a lookup, or none when it is of another kind."""
    maps = []
    for subtable in lookup.SubTable:
        if lookup.LookupType == EXTENSION_SUBSTITUTION:
            subtable = subtable.ExtSubTable
        if hasattr(subtable, "mapping"):
            maps.append(subtable.mapping)
    return maps


def bulgarian_lookups(font):
    """The `locl` lookups the Bulgarian language system selects, in lookup order."""
    gsub = font["GSUB"].table
    for script in gsub.ScriptList.ScriptRecord:
        if script.ScriptTag != SCRIPT:
            continue
        for language in script.Script.LangSysRecord:
            if language.LangSysTag != LANGUAGE:
                continue
            indices = set()
            for index in language.LangSys.FeatureIndex:
                record = gsub.FeatureList.FeatureRecord[index]
                if record.FeatureTag == FEATURE:
                    indices.update(record.Feature.LookupListIndex)
            return [gsub.LookupList.Lookup[index] for index in sorted(indices)]
    return []


def freeze(font):
    """Points the cmap at the Bulgarian glyphs; returns how many code points changed."""
    maps = [
        mapping
        for lookup in bulgarian_lookups(font)
        for mapping in single_substitutions(lookup)
    ]
    changed = set()
    for table in font["cmap"].tables:
        for code_point, glyph in list(table.cmap.items()):
            for mapping in maps:
                glyph = mapping.get(glyph, glyph)
            if glyph != table.cmap[code_point]:
                table.cmap[code_point] = glyph
                changed.add(code_point)
    return len(changed)


def main():
    for name in SOURCES:
        font = TTFont(GUEST_FONTS / f"{name}.woff2", recalcTimestamp=False)
        font.flavor = None
        changed = freeze(font)
        if changed == 0:
            raise SystemExit(f"{name}: no Bulgarian forms found to freeze")
        font.save(PRINT_KIT_FONTS / f"{name}.ttf")
        print(f"{name}: {changed} code points now draw their Bulgarian form")


if __name__ == "__main__":
    main()
