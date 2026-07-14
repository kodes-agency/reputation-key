#!/usr/bin/env python3
"""Generate the Google Business Profile AI policy clarification PDF."""

from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    HRFlowable,
    KeepTogether,
    PageBreak,
    PageTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
)


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = (
    ROOT
    / "docs"
    / "product-readiness-program-2026-07"
    / "attachments"
    / "reputation-key-google-ai-policy-clarification.pdf"
)

PAGE_W, PAGE_H = A4
MARGIN_X = 17 * mm
MARGIN_TOP = 17 * mm
MARGIN_BOTTOM = 15 * mm

INK = colors.HexColor("#252331")
MUTED = colors.HexColor("#666276")
FAINT = colors.HexColor("#F6F4FA")
LINE = colors.HexColor("#E3DFEA")
VIOLET = colors.HexColor("#5C2AAE")
VIOLET_DARK = colors.HexColor("#442080")
VIOLET_PALE = colors.HexColor("#F0EAF8")
GREEN = colors.HexColor("#2A7B5F")
GREEN_PALE = colors.HexColor("#EAF6F1")
WHITE = colors.white


def register_fonts() -> None:
    font_dir = Path("/System/Library/Fonts/Supplemental")
    pdfmetrics.registerFont(TTFont("RKRegular", str(font_dir / "Arial.ttf")))
    pdfmetrics.registerFont(TTFont("RKBold", str(font_dir / "Arial Bold.ttf")))
    pdfmetrics.registerFont(TTFont("RKItalic", str(font_dir / "Arial Italic.ttf")))
    pdfmetrics.registerFontFamily(
        "RK",
        normal="RKRegular",
        bold="RKBold",
        italic="RKItalic",
        boldItalic="RKBold",
    )


register_fonts()


class NumberedCanvasMixin:
    """Marker mixin for type clarity in callbacks."""


def header_footer(canvas, doc) -> None:
    canvas.saveState()
    canvas.setFillColor(VIOLET)
    canvas.rect(0, PAGE_H - 4 * mm, PAGE_W, 4 * mm, stroke=0, fill=1)

    canvas.setFont("RKBold", 8)
    canvas.setFillColor(VIOLET_DARK)
    canvas.drawString(MARGIN_X, PAGE_H - 11 * mm, "REPUTATION KEY")
    canvas.setFont("RKRegular", 7.5)
    canvas.setFillColor(MUTED)
    canvas.drawRightString(PAGE_W - MARGIN_X, PAGE_H - 11 * mm, "GBP API POLICY CLARIFICATION")

    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.6)
    canvas.line(MARGIN_X, 11 * mm, PAGE_W - MARGIN_X, 11 * mm)
    canvas.setFont("RKRegular", 7)
    canvas.setFillColor(MUTED)
    canvas.drawString(MARGIN_X, 7 * mm, "reputationkey.app  |  info@kodes.agency")
    canvas.drawRightString(PAGE_W - MARGIN_X, 7 * mm, f"Page {doc.page}")
    canvas.restoreState()


styles = getSampleStyleSheet()

STYLE = {
    "eyebrow": ParagraphStyle(
        "Eyebrow",
        fontName="RKBold",
        fontSize=7.5,
        leading=9,
        textColor=VIOLET,
        spaceAfter=4,
    ),
    "title": ParagraphStyle(
        "Title",
        fontName="RKBold",
        fontSize=23,
        leading=27,
        textColor=INK,
        spaceAfter=5,
    ),
    "subtitle": ParagraphStyle(
        "Subtitle",
        fontName="RKRegular",
        fontSize=10.5,
        leading=14,
        textColor=MUTED,
        spaceAfter=10,
    ),
    "h2": ParagraphStyle(
        "H2",
        fontName="RKBold",
        fontSize=12.5,
        leading=15,
        textColor=INK,
        spaceBefore=7,
        spaceAfter=4,
    ),
    "h3": ParagraphStyle(
        "H3",
        fontName="RKBold",
        fontSize=9.5,
        leading=11,
        textColor=VIOLET_DARK,
        spaceAfter=2,
    ),
    "body": ParagraphStyle(
        "Body",
        fontName="RKRegular",
        fontSize=8.7,
        leading=12,
        textColor=INK,
        spaceAfter=4,
    ),
    "small": ParagraphStyle(
        "Small",
        fontName="RKRegular",
        fontSize=7.7,
        leading=10.3,
        textColor=MUTED,
    ),
    "card": ParagraphStyle(
        "Card",
        fontName="RKRegular",
        fontSize=8,
        leading=10.5,
        textColor=INK,
    ),
    "card_title": ParagraphStyle(
        "CardTitle",
        fontName="RKBold",
        fontSize=8.8,
        leading=10.5,
        textColor=VIOLET_DARK,
        spaceAfter=2,
    ),
    "question": ParagraphStyle(
        "Question",
        fontName="RKRegular",
        fontSize=8.05,
        leading=10.8,
        textColor=INK,
        leftIndent=7 * mm,
        firstLineIndent=-7 * mm,
        spaceAfter=3.2,
    ),
    "meta_label": ParagraphStyle(
        "MetaLabel",
        fontName="RKBold",
        fontSize=6.8,
        leading=8,
        textColor=MUTED,
    ),
    "meta_value": ParagraphStyle(
        "MetaValue",
        fontName="RKRegular",
        fontSize=8.2,
        leading=10,
        textColor=INK,
    ),
    "flow": ParagraphStyle(
        "Flow",
        fontName="RKBold",
        fontSize=7.1,
        leading=8.5,
        alignment=TA_CENTER,
        textColor=INK,
    ),
    "reference": ParagraphStyle(
        "Reference",
        fontName="RKRegular",
        fontSize=6.9,
        leading=9,
        textColor=MUTED,
        leftIndent=4 * mm,
        firstLineIndent=-4 * mm,
        spaceAfter=1.5,
    ),
}


def p(text: str, style: str = "body") -> Paragraph:
    return Paragraph(text, STYLE[style])


def meta_cell(label: str, value: str) -> list[Paragraph]:
    return [p(label.upper(), "meta_label"), p(value, "meta_value")]


def info_card(title: str, body: str) -> Table:
    table = Table(
        [[[p(title, "card_title"), p(body, "card")]]],
        colWidths=[(PAGE_W - 2 * MARGIN_X - 5 * mm) / 2],
    )
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), FAINT),
                ("BOX", (0, 0), (-1, -1), 0.6, LINE),
                ("LEFTPADDING", (0, 0), (-1, -1), 4 * mm),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4 * mm),
                ("TOPPADDING", (0, 0), (-1, -1), 3.2 * mm),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3.2 * mm),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )
    return table


def callout(title: str, body: str) -> Table:
    table = Table(
        [[p(title, "card_title"), p(body, "card")]],
        colWidths=[31 * mm, PAGE_W - 2 * MARGIN_X - 31 * mm],
    )
    table.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), VIOLET_PALE),
                ("BOX", (0, 0), (-1, -1), 0.7, colors.HexColor("#D7C9E9")),
                ("LEFTPADDING", (0, 0), (-1, -1), 4 * mm),
                ("RIGHTPADDING", (0, 0), (-1, -1), 4 * mm),
                ("TOPPADDING", (0, 0), (-1, -1), 3.2 * mm),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3.2 * mm),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ]
        )
    )
    return table


def flow_diagram() -> Table:
    items = [
        "Authorized<br/>manager",
        "GBP Reviews<br/>API",
        "Identity<br/>minimization",
        "External<br/>model",
        "Property-only<br/>result",
    ]
    row = []
    for index, item in enumerate(items):
        row.append(p(item, "flow"))
        if index < len(items) - 1:
            row.append(p("-&gt;", "flow"))

    usable = PAGE_W - 2 * MARGIN_X
    box_width = 29.2 * mm
    arrow_width = (usable - box_width * 5) / 4
    table = Table([row], colWidths=sum(([box_width, arrow_width] for _ in range(4)), []) + [box_width])
    commands = [
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("TOPPADDING", (0, 0), (-1, -1), 3 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3 * mm),
    ]
    for col in (0, 2, 4, 6, 8):
        commands.extend(
            [
                ("BACKGROUND", (col, 0), (col, 0), FAINT),
                ("BOX", (col, 0), (col, 0), 0.6, LINE),
                ("LEFTPADDING", (col, 0), (col, 0), 2 * mm),
                ("RIGHTPADDING", (col, 0), (col, 0), 2 * mm),
            ]
        )
    table.setStyle(TableStyle(commands))
    return table


def safeguard_table() -> Table:
    data = [
        [p("Data sent", "card_title"), p("Review text, star rating, review date, language, and limited property context.", "card")],
        [p("Data excluded", "card_title"), p("Reviewer name, profile URL, profile photo, and unrelated reviewer metadata.", "card")],
        [p("Provider controls", "card_title"), p("No model training on customer content; shortest available retention; regional processing where required.", "card")],
        [p("User control", "card_title"), p("Customer AI opt-in; editable drafts; separate Publish action; AI can be disabled.", "card")],
        [p("Operational controls", "card_title"), p("No prompt bodies in ordinary logs; metadata-only audit trail; AI failures do not block non-AI features.", "card")],
    ]
    table = Table(data, colWidths=[37 * mm, PAGE_W - 2 * MARGIN_X - 37 * mm], repeatRows=0)
    commands = [
        ("BOX", (0, 0), (-1, -1), 0.6, LINE),
        ("INNERGRID", (0, 0), (-1, -1), 0.45, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 3.2 * mm),
        ("RIGHTPADDING", (0, 0), (-1, -1), 3.2 * mm),
        ("TOPPADDING", (0, 0), (-1, -1), 2.5 * mm),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5 * mm),
    ]
    for row in range(len(data)):
        if row % 2 == 0:
            commands.append(("BACKGROUND", (0, row), (-1, row), FAINT))
    table.setStyle(TableStyle(commands))
    return table


def build_story() -> list:
    story = []

    story.extend(
        [
            Spacer(1, 2 * mm),
            p("POLICY CLARIFICATION REQUEST", "eyebrow"),
            p("AI-assisted processing of Google Business Profile reviews", "title"),
            p(
                "A proposed data flow for review classification, manager-requested reply drafts, "
                "and property-level theme reporting.",
                "subtitle",
            ),
        ]
    )

    metadata = Table(
        [[
            meta_cell("Submitted by", "Reputation Key (RepKey)"),
            meta_cell("Date", "14 July 2026"),
            meta_cell("Status", "Proposed - not in production"),
        ]],
        colWidths=[63 * mm, 38 * mm, PAGE_W - 2 * MARGIN_X - 101 * mm],
    )
    metadata.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), WHITE),
                ("BOX", (0, 0), (-1, -1), 0.6, LINE),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, LINE),
                ("LEFTPADDING", (0, 0), (-1, -1), 3.4 * mm),
                ("RIGHTPADDING", (0, 0), (-1, -1), 3.4 * mm),
                ("TOPPADDING", (0, 0), (-1, -1), 2.5 * mm),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 2.5 * mm),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )
    story.extend([metadata, Spacer(1, 4 * mm)])

    story.append(
        callout(
            "Decision requested",
            "Please confirm whether the proposed uses are permitted and identify any required "
            "retention, deletion, consent, provider, or processing-location conditions.",
        )
    )

    story.extend(
        [
            p("Purpose and customer authorization", "h2"),
            p(
                "Reputation Key is a review-management service for hotels and other multi-location "
                "businesses. A manager connects a Google Business Profile account through Google "
                "OAuth. RepKey retrieves reviews only for locations the customer owns or is "
                "authorized to manage, and results remain visible only to authorized users of that property.",
            ),
            p(
                "Before implementation, we are asking how the Business Profile API content-storage "
                "and automated-use policies apply - especially the restriction on manipulating or "
                "aggregating API content, the 30-day limit, and external model processing.",
            ),
            p("Proposed functionality", "h2"),
        ]
    )

    card_width = (PAGE_W - 2 * MARGIN_X - 5 * mm) / 2
    cards = Table(
        [
            [
                info_card(
                    "1. Review analysis",
                    "A minimized review payload is classified for sentiment and service category. "
                    "RepKey calculates priority from rating, sentiment, and review age.",
                ),
                info_card(
                    "2. Reply drafting",
                    "A manager requests and edits a draft, then uses a separate Publish action. "
                    "Nothing is generated and posted automatically.",
                ),
            ],
            [
                info_card(
                    "3. Property themes",
                    "Up to 100 recent reviews from one property are analyzed for themes, trajectories, "
                    "and a short summary. Properties are never combined.",
                ),
                info_card(
                    "4. Historical pass",
                    "A newly connected property may opt into a one-time classification of existing "
                    "reviews. The content is not used for model training or fine-tuning.",
                ),
            ],
        ],
        colWidths=[card_width, card_width],
        hAlign="LEFT",
    )
    cards.setStyle(
        TableStyle(
            [
                ("LEFTPADDING", (0, 0), (-1, -1), 0),
                ("RIGHTPADDING", (0, 0), (-1, -1), 0),
                ("TOPPADDING", (0, 0), (-1, -1), 0),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3 * mm),
                ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ]
        )
    )
    story.extend([cards, p("Proposed data flow", "h2"), flow_diagram()])

    story.extend(
        [
            Spacer(1, 3.5 * mm),
            p(
                "The model provider has not been selected. Options under consideration include the "
                "OpenAI API, Azure OpenAI, and models available through AWS Bedrock. Provider selection "
                "depends in part on Google's guidance.",
                "small",
            ),
            PageBreak(),
            Spacer(1, 2 * mm),
            p("PROPOSED SAFEGUARDS AND QUESTIONS", "eyebrow"),
            p("Data handling proposed by RepKey", "title"),
            p(
                "These controls are design commitments for the proposed features. Final retention and "
                "regional settings will follow Google's response and the selected provider contract.",
                "subtitle",
            ),
            safeguard_table(),
            p("Points requiring clarification", "h2"),
        ]
    )

    questions = [
        "May minimized review content be sent to a contracted external language-model provider for "
        "sentiment classification, categorization, priority scoring support, and reply drafting?",
        "Is creating or retaining sentiment labels, categories, and priority scores considered "
        "prohibited manipulation of Business Profile API content?",
        "Is identifying themes and producing a summary from reviews belonging to one property "
        "considered prohibited aggregation when properties are never combined?",
        "Does the 30-day storage limit apply only to review content returned by the API, or also to "
        "derived labels, scores, themes, trajectories, and summaries?",
        "If derived results are permitted, may they remain after the underlying API content is "
        "refreshed or deleted? What must be deleted when a customer disconnects?",
        "Is an optional one-time analysis of existing reviews allowed, or would it be treated as "
        "prohibited pre-fetching, caching, or indexing?",
        "May up to three replies previously published by the same property be used as style examples "
        "for a new reply draft?",
        "For analysis, are OAuth authorization and a clear customer AI opt-in sufficient? For replies, "
        "do separate Generate draft and Publish reply actions satisfy prior specific and express consent?",
        "Are there additional requirements for the model provider, processing location, retention, "
        "data-processing agreement, or subprocessors?",
    ]
    for number, question in enumerate(questions, 1):
        story.append(p(f"<b>{number}.</b> {question}", "question"))

    story.extend(
        [
            Spacer(1, 1 * mm),
            callout(
                "Requested response",
                "Written confirmation for each point, including any conditions required for compliance. "
                "If policy interpretation is needed, please refer the case to the Google Business Profile API policy team.",
            ),
            p("References", "h2"),
            p(
                '1. <link href="https://developers.google.com/my-business/content/policies" color="#5C2AAE">'
                "Google Business Profile API policies</link>",
                "reference",
            ),
            p(
                '2. <link href="https://developers.google.com/terms/api-services-user-data-policy" color="#5C2AAE">'
                "Google API Services User Data Policy</link>",
                "reference",
            ),
            p(
                '3. <link href="https://developers.google.com/terms/" color="#5C2AAE">'
                "Google APIs Terms of Service</link>",
                "reference",
            ),
            Spacer(1, 1 * mm),
            p(
                "Google Cloud project number: supplied in the associated private support case. "
                "No credentials, customer names, or real review content are included in this document.",
                "small",
            ),
        ]
    )
    return story


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    doc = BaseDocTemplate(
        str(OUTPUT),
        pagesize=A4,
        leftMargin=MARGIN_X,
        rightMargin=MARGIN_X,
        topMargin=MARGIN_TOP,
        bottomMargin=MARGIN_BOTTOM,
        title="Request for clarification on AI-assisted processing of Google Business Profile reviews",
        author="Reputation Key",
        subject="Google Business Profile API policy clarification request",
        creator="Reputation Key",
    )
    frame = Frame(
        MARGIN_X,
        MARGIN_BOTTOM,
        PAGE_W - 2 * MARGIN_X,
        PAGE_H - MARGIN_TOP - MARGIN_BOTTOM,
        leftPadding=0,
        rightPadding=0,
        topPadding=0,
        bottomPadding=0,
        id="normal",
    )
    doc.addPageTemplates([PageTemplate(id="policy", frames=[frame], onPage=header_footer)])
    doc.build(build_story())
    print(OUTPUT)


if __name__ == "__main__":
    main()
