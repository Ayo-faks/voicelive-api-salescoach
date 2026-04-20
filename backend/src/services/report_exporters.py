"""Export context builders and renderers for progress reports."""

from __future__ import annotations

from dataclasses import dataclass
from html import escape
from io import BytesIO
from typing import Any, Dict, List, Optional, Sequence, cast

from .report_pipeline import (
    DEFAULT_AUDIENCE,
    DEFAULT_REPORT_TYPE,
    SessionSelectionResolver,
    format_date,
    format_session_metrics,
    normalize_session_ids,
)
from .report_redaction import (
    INTERNAL_METADATA_CARD_LABELS,
    REDACTION_HIDE_INTERNAL_METADATA,
    REDACTION_HIDE_OVERVIEW_METRICS,
    REDACTION_HIDE_SESSION_LIST,
    REDACTION_HIDE_SUMMARY_TEXT,
    ReportRedactionPolicy,
)

try:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
    from reportlab.lib.units import mm
    from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

    REPORTLAB_AVAILABLE = True
except ImportError:
    colors = None
    A4 = None
    ParagraphStyle = None
    getSampleStyleSheet = None
    mm = None
    Paragraph = None
    SimpleDocTemplate = None
    Spacer = None
    Table = None
    TableStyle = None
    REPORTLAB_AVAILABLE = False


@dataclass(frozen=True)
class ExportContext:
    report: Dict[str, Any]
    child_name: str
    subtitle: str
    summary_text: str
    metric_cards: List[tuple[str, str]]
    included_sessions: List[Dict[str, Any]]
    sections: List[Dict[str, Any]]
    badges: List[str]
    show_summary_text: bool
    show_overview_metrics: bool
    show_session_list: bool
    redaction_notice: Optional[str]


def pdf_text(value: Any) -> str:
    return escape(str(value or "")).replace("\n", "<br />")


class ReportExportContextBuilder:
    def __init__(
        self,
        *,
        storage_service: Any,
        session_resolver: SessionSelectionResolver,
        redaction_policy: ReportRedactionPolicy,
    ):
        self.storage_service = storage_service
        self.session_resolver = session_resolver
        self.redaction_policy = redaction_policy

    def build(self, report: Dict[str, Any]) -> ExportContext:
        child_id = str(report.get("child_id") or "")
        snapshot = cast(Dict[str, Any], report.get("snapshot") or {})
        child = self.storage_service.get_child(child_id) or {"name": snapshot.get("child_name")}
        session_summaries = self.storage_service.list_sessions_for_child(child_id)
        included_session_ids = normalize_session_ids(report.get("included_session_ids"))
        included_sessions = self.session_resolver.resolve_included_sessions(
            session_summaries,
            included_session_ids=included_session_ids,
            period_start=str(report.get("period_start") or "") or None,
            period_end=str(report.get("period_end") or "") or None,
            selection_provided=bool(included_session_ids),
        )
        redaction_overrides = self.redaction_policy.normalize_overrides(report.get("redaction_overrides"))
        child_name = str(snapshot.get("child_name") or child.get("name") or "Child").strip() or "Child"
        focus_target_list = cast(List[str], snapshot.get("focus_targets") or [])
        focus_targets = ", ".join(focus_target_list) or "No tagged target sound"
        metric_cards = [
            ("Audience", str(report.get("audience") or DEFAULT_AUDIENCE).title()),
            ("Status", str(report.get("status") or "draft").title()),
            ("Report window", f"{format_date(report.get('period_start'))} to {format_date(report.get('period_end'))}"),
            ("Reviewed sessions", str(snapshot.get("session_count") or len(included_sessions) or 0)),
            ("Focus targets", focus_targets),
            ("Generated", format_date(snapshot.get("generated_at") or report.get("updated_at"))),
        ]
        if redaction_overrides[REDACTION_HIDE_INTERNAL_METADATA]:
            metric_cards = [
                (label, value)
                for label, value in metric_cards
                if label not in INTERNAL_METADATA_CARD_LABELS
            ]

        badges: List[str] = []
        if not redaction_overrides[REDACTION_HIDE_INTERNAL_METADATA]:
            badges.extend(
                [
                    f"{str(report.get('audience') or DEFAULT_AUDIENCE).title()} audience",
                    str(report.get("status") or "draft").title(),
                ]
            )
        if focus_target_list:
            badges.append(focus_targets)

        sections = self.redaction_policy.filter_sections_for_export(
            cast(List[Dict[str, Any]], report.get("sections") or []),
            redaction_overrides,
        )
        if not sections:
            sections = [
                {
                    "key": "export-view",
                    "title": "Export view",
                    "narrative": "All shareable sections are currently hidden for this export.",
                }
            ]

        return ExportContext(
            report=report,
            child_name=child_name,
            subtitle=f"{child_name} • {str(report.get('report_type') or DEFAULT_REPORT_TYPE).replace('_', ' ')}",
            summary_text=str(report.get("summary_text") or "").strip() or "No summary note has been saved for this report yet.",
            metric_cards=metric_cards,
            included_sessions=included_sessions,
            sections=sections,
            badges=badges,
            show_summary_text=not redaction_overrides[REDACTION_HIDE_SUMMARY_TEXT],
            show_overview_metrics=not redaction_overrides[REDACTION_HIDE_OVERVIEW_METRICS] and bool(metric_cards),
            show_session_list=not redaction_overrides[REDACTION_HIDE_SESSION_LIST],
            redaction_notice=self.redaction_policy.build_redaction_notice(redaction_overrides),
        )


class HtmlReportExporter:
    def render(self, export_context: ExportContext) -> str:
        report = export_context.report
        session_items_html = "".join(
            f"<li><span class=\"session-date\">{escape(format_date(session.get('timestamp')))}</span><strong>{escape(str(cast(Dict[str, Any], session.get('exercise') or {}).get('name') or 'Saved session'))}</strong><span>{escape(format_session_metrics(session))}</span></li>"
            for session in export_context.included_sessions
        ) or "<li><strong>No saved sessions were available when this export was generated.</strong></li>"
        section_blocks_html = "".join(self._render_section_html(section) for section in export_context.sections)
        badge_html = "".join(f"<span class=\"badge\">{escape(badge)}</span>" for badge in export_context.badges)
        summary_html = (
            f"<div class=\"summary\"><p class=\"summary-title\">Executive summary</p><p class=\"summary-text\">{escape(export_context.summary_text)}</p></div>"
            if export_context.show_summary_text
            else ""
        )
        metric_cards_html = "".join(
            f"<div class=\"metric-card\"><p class=\"metric-label\">{escape(label)}</p><p class=\"metric-value\">{escape(value)}</p></div>"
            for label, value in export_context.metric_cards
        )
        metrics_html = (
            f"<div class=\"metrics\">{metric_cards_html}</div>"
            if export_context.show_overview_metrics
            else ""
        )
        session_panel_html = (
            f"<aside class=\"panel\"><h2>Included sessions</h2><ol class=\"session-list\">{session_items_html}</ol></aside>"
            if export_context.show_session_list
            else ""
        )
        footer_notice_html = f"<p class=\"footer\">{escape(export_context.redaction_notice)}</p>" if export_context.redaction_notice else ""
        content_grid_class = "content-grid" if export_context.show_session_list else "content-grid single-column"
        badge_row_html = f"<div class=\"badge-row\">{badge_html}</div>" if badge_html else ""

        return f"""<!doctype html>
<html lang=\"en\">
    <head>
        <meta charset=\"utf-8\" />
        <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
        <title>{escape(str(report.get('title') or 'Progress report'))}</title>
        <style>
            @page {{
                size: A4;
                margin: 14mm;
            }}

            :root {{
                color-scheme: light;
                --ink: #16303c;
                --muted: #56717c;
                --line: #d9e2e6;
                --surface: #f7fbfc;
                --surface-strong: #eef5f6;
                --accent: #127a72;
                --accent-soft: rgba(18, 122, 114, 0.12);
            }}

            * {{ box-sizing: border-box; }}
            body {{
                margin: 0;
                font-family: \"Segoe UI\", \"Helvetica Neue\", Arial, sans-serif;
                color: var(--ink);
                background: white;
            }}
            .page {{
                max-width: 940px;
                margin: 0 auto;
            }}
            .toolbar {{
                display: flex;
                justify-content: flex-end;
                margin-bottom: 18px;
            }}
            .print-button {{
                border: 0;
                background: var(--accent);
                color: white;
                padding: 10px 16px;
                border-radius: 999px;
                font-weight: 600;
                cursor: pointer;
            }}
            .hero {{
                padding: 28px;
                border: 1px solid var(--line);
                background: linear-gradient(135deg, #fbfdfd, #f1f7f8);
            }}
            .eyebrow {{
                color: var(--muted);
                font-size: 12px;
                text-transform: uppercase;
                letter-spacing: 0.12em;
                font-weight: 700;
            }}
            h1 {{
                margin: 10px 0 8px;
                font-size: 32px;
                line-height: 1.1;
            }}
            .subtitle {{
                margin: 0;
                color: var(--muted);
                font-size: 15px;
                line-height: 1.6;
            }}
            .badge-row {{
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                margin-top: 18px;
            }}
            .badge {{
                display: inline-flex;
                align-items: center;
                padding: 6px 12px;
                border-radius: 999px;
                background: var(--accent-soft);
                color: var(--accent);
                font-size: 12px;
                font-weight: 700;
            }}
            .summary {{
                margin-top: 18px;
                padding: 18px;
                border: 1px solid var(--line);
                background: white;
            }}
            .summary-title {{
                margin: 0 0 8px;
                font-size: 12px;
                text-transform: uppercase;
                letter-spacing: 0.08em;
                color: var(--muted);
                font-weight: 700;
            }}
            .summary-text {{
                margin: 0;
                font-size: 15px;
                line-height: 1.7;
            }}
            .metrics {{
                display: grid;
                grid-template-columns: repeat(3, minmax(0, 1fr));
                gap: 12px;
                margin-top: 18px;
            }}
            .metric-card {{
                padding: 14px;
                border: 1px solid var(--line);
                background: var(--surface);
                min-height: 92px;
            }}
            .metric-label {{
                margin: 0 0 8px;
                color: var(--muted);
                font-size: 12px;
                text-transform: uppercase;
                letter-spacing: 0.08em;
                font-weight: 700;
            }}
            .metric-value {{
                margin: 0;
                font-size: 18px;
                line-height: 1.35;
                font-weight: 700;
            }}
            .content-grid {{
                display: grid;
                grid-template-columns: minmax(220px, 280px) minmax(0, 1fr);
                gap: 18px;
                margin-top: 18px;
            }}
            .content-grid.single-column {{
                grid-template-columns: 1fr;
            }}
            .panel {{
                padding: 18px;
                border: 1px solid var(--line);
                background: white;
            }}
            .panel h2 {{
                margin: 0 0 12px;
                font-size: 18px;
            }}
            .session-list {{
                margin: 0;
                padding-left: 18px;
                display: grid;
                gap: 12px;
            }}
            .session-list li {{
                break-inside: avoid;
            }}
            .session-list strong {{
                display: block;
                margin: 4px 0;
            }}
            .session-date {{
                color: var(--muted);
                font-size: 12px;
            }}
            .section {{
                padding: 18px;
                border: 1px solid var(--line);
                background: white;
                break-inside: avoid;
            }}
            .section + .section {{
                margin-top: 14px;
            }}
            .section h3 {{
                margin: 0 0 12px;
                font-size: 18px;
            }}
            .section p {{
                margin: 0;
                line-height: 1.7;
            }}
            .section ul {{
                margin: 12px 0 0;
                padding-left: 18px;
                display: grid;
                gap: 8px;
            }}
            .section-metrics {{
                display: grid;
                grid-template-columns: repeat(2, minmax(0, 1fr));
                gap: 10px;
                margin-top: 12px;
            }}
            .section-metric {{
                padding: 12px;
                border: 1px solid var(--line);
                background: var(--surface-strong);
            }}
            .section-metric-label {{
                display: block;
                font-size: 12px;
                color: var(--muted);
                margin-bottom: 6px;
                text-transform: uppercase;
                letter-spacing: 0.08em;
                font-weight: 700;
            }}
            .section-metric-value {{
                font-size: 17px;
                font-weight: 700;
            }}
            .footer {{
                margin-top: 18px;
                color: var(--muted);
                font-size: 12px;
                line-height: 1.6;
            }}
            @media (max-width: 760px) {{
                .metrics,
                .content-grid,
                .section-metrics {{
                    grid-template-columns: 1fr;
                }}
            }}
            @media print {{
                .toolbar {{ display: none; }}
                body {{ background: white; }}
                .page {{ max-width: none; }}
            }}
        </style>
    </head>
    <body>
        <main class=\"page\">
            <div class=\"toolbar\">
                <button class=\"print-button\" type=\"button\" onclick=\"window.print()\">Print or save as PDF</button>
            </div>

            <section class=\"hero\">
                <div class=\"eyebrow\">Wulo progress report</div>
                <h1>{escape(str(report.get('title') or 'Progress report'))}</h1>
                <p class=\"subtitle\">{escape(export_context.subtitle)}</p>

                {badge_row_html}
                {summary_html}
                {metrics_html}
            </section>

            <section class=\"{content_grid_class}\">
                {session_panel_html}
                <div>{section_blocks_html}</div>
            </section>

            <p class=\"footer\">This document summarizes therapist-reviewed Wulo practice data. It supports supervision, family communication, and school coordination, but it does not replace clinical judgment or diagnosis.</p>
            {footer_notice_html}
        </main>
    </body>
</html>
"""

    def _render_section_html(self, section: Dict[str, Any]) -> str:
        metrics = cast(List[Dict[str, Any]], section.get("metrics") or [])
        bullets = cast(List[str], section.get("bullets") or [])
        metric_html = "".join(
            f"<div class=\"section-metric\"><span class=\"section-metric-label\">{escape(str(metric.get('label') or 'Metric'))}</span><span class=\"section-metric-value\">{escape(str(metric.get('value') or '—'))}</span></div>"
            for metric in metrics
        )
        bullet_html = "".join(f"<li>{escape(str(bullet))}</li>" for bullet in bullets)
        narrative = str(section.get("narrative") or "").strip()
        content_parts = [f"<section class=\"section\"><h3>{escape(str(section.get('title') or 'Section'))}</h3>"]
        if narrative:
            content_parts.append(f"<p>{escape(narrative)}</p>")
        if metric_html:
            content_parts.append(f"<div class=\"section-metrics\">{metric_html}</div>")
        if bullet_html:
            content_parts.append(f"<ul>{bullet_html}</ul>")
        content_parts.append("</section>")
        return "".join(content_parts)


class PdfReportExporter:
    def render(self, export_context: ExportContext) -> bytes:
        if not REPORTLAB_AVAILABLE:
            raise RuntimeError("PDF export is unavailable until the reportlab dependency is installed")

        report = export_context.report
        buffer = BytesIO()
        document = SimpleDocTemplate(
            buffer,
            pagesize=A4,
            leftMargin=14 * mm,
            rightMargin=14 * mm,
            topMargin=16 * mm,
            bottomMargin=16 * mm,
            title=str(report.get("title") or "Progress report"),
        )
        styles = self._build_pdf_styles()
        story: List[Any] = [
            Paragraph("WULO PROGRESS REPORT", styles["ReportEyebrow"]),
            Paragraph(pdf_text(str(report.get("title") or "Progress report")), styles["ReportTitle"]),
            Paragraph(pdf_text(export_context.subtitle), styles["ReportSubtitle"]),
        ]

        if export_context.badges:
            story.extend(
                [
                    Spacer(1, 6),
                    Paragraph(pdf_text(" • ".join(export_context.badges)), styles["ReportBadges"]),
                ]
            )

        if export_context.show_summary_text:
            story.extend(
                [
                    Spacer(1, 14),
                    Paragraph("Executive summary", styles["ReportSectionLabel"]),
                    Paragraph(pdf_text(export_context.summary_text), styles["ReportBody"]),
                ]
            )

        if export_context.show_overview_metrics:
            story.extend(
                [
                    Spacer(1, 14),
                    Paragraph("Overview metrics", styles["ReportSectionLabel"]),
                    self._build_pdf_metric_table(export_context.metric_cards, styles, document.width),
                ]
            )

        if export_context.show_session_list:
            story.extend(
                [
                    Spacer(1, 16),
                    Paragraph("Included sessions", styles["ReportHeading"]),
                ]
            )
            for session in export_context.included_sessions:
                session_name = str(cast(Dict[str, Any], session.get("exercise") or {}).get("name") or "Saved session")
                session_copy = f"{format_date(session.get('timestamp'))} — {session_name}. {format_session_metrics(session)}"
                story.append(Paragraph(pdf_text(session_copy), styles["ReportBullet"]))

        for section in export_context.sections:
            self._append_pdf_section_story(story, section, styles, document.width)

        story.extend(
            [
                Spacer(1, 16),
                Paragraph(
                    "This document summarizes therapist-reviewed Wulo practice data. It supports supervision, family communication, and school coordination, but it does not replace clinical judgment or diagnosis.",
                    styles["ReportFooter"],
                ),
            ]
        )
        if export_context.redaction_notice:
            story.append(Paragraph(pdf_text(export_context.redaction_notice), styles["ReportFooter"]))

        document.build(
            story,
            onFirstPage=self._draw_pdf_footer,
            onLaterPages=self._draw_pdf_footer,
        )
        return buffer.getvalue()

    def _build_pdf_styles(self) -> Dict[str, Any]:
        stylesheet = getSampleStyleSheet()
        return {
            "ReportEyebrow": ParagraphStyle(
                "ReportEyebrow",
                parent=stylesheet["BodyText"],
                fontName="Helvetica-Bold",
                fontSize=8,
                leading=10,
                textColor=colors.HexColor("#56717c"),
                spaceAfter=4,
            ),
            "ReportTitle": ParagraphStyle(
                "ReportTitle",
                parent=stylesheet["Heading1"],
                fontName="Helvetica-Bold",
                fontSize=22,
                leading=26,
                textColor=colors.HexColor("#16303c"),
                spaceAfter=4,
            ),
            "ReportSubtitle": ParagraphStyle(
                "ReportSubtitle",
                parent=stylesheet["BodyText"],
                fontSize=11,
                leading=15,
                textColor=colors.HexColor("#56717c"),
            ),
            "ReportBadges": ParagraphStyle(
                "ReportBadges",
                parent=stylesheet["BodyText"],
                fontName="Helvetica-Bold",
                fontSize=9,
                leading=12,
                textColor=colors.HexColor("#127a72"),
            ),
            "ReportSectionLabel": ParagraphStyle(
                "ReportSectionLabel",
                parent=stylesheet["BodyText"],
                fontName="Helvetica-Bold",
                fontSize=8,
                leading=10,
                textColor=colors.HexColor("#56717c"),
                spaceAfter=4,
            ),
            "ReportHeading": ParagraphStyle(
                "ReportHeading",
                parent=stylesheet["Heading2"],
                fontName="Helvetica-Bold",
                fontSize=14,
                leading=18,
                textColor=colors.HexColor("#16303c"),
                spaceAfter=6,
                spaceBefore=10,
            ),
            "ReportBody": ParagraphStyle(
                "ReportBody",
                parent=stylesheet["BodyText"],
                fontSize=10,
                leading=15,
                textColor=colors.HexColor("#16303c"),
                spaceAfter=6,
            ),
            "ReportBullet": ParagraphStyle(
                "ReportBullet",
                parent=stylesheet["BodyText"],
                fontSize=10,
                leading=14,
                leftIndent=12,
                firstLineIndent=-10,
                spaceAfter=4,
                textColor=colors.HexColor("#16303c"),
            ),
            "ReportMetricLabel": ParagraphStyle(
                "ReportMetricLabel",
                parent=stylesheet["BodyText"],
                fontName="Helvetica-Bold",
                fontSize=8,
                leading=10,
                textColor=colors.HexColor("#56717c"),
            ),
            "ReportMetricValue": ParagraphStyle(
                "ReportMetricValue",
                parent=stylesheet["BodyText"],
                fontName="Helvetica-Bold",
                fontSize=10,
                leading=12,
                textColor=colors.HexColor("#16303c"),
            ),
            "ReportFooter": ParagraphStyle(
                "ReportFooter",
                parent=stylesheet["BodyText"],
                fontSize=8,
                leading=11,
                textColor=colors.HexColor("#56717c"),
                spaceAfter=4,
            ),
        }

    def _append_pdf_section_story(
        self,
        story: List[Any],
        section: Dict[str, Any],
        styles: Dict[str, Any],
        content_width: float,
    ) -> None:
        story.extend(
            [
                Spacer(1, 14),
                Paragraph(pdf_text(str(section.get("title") or "Section")), styles["ReportHeading"]),
            ]
        )
        narrative = str(section.get("narrative") or "").strip()
        if narrative:
            story.append(Paragraph(pdf_text(narrative), styles["ReportBody"]))

        metrics = cast(List[Dict[str, Any]], section.get("metrics") or [])
        if metrics:
            story.append(
                self._build_pdf_metric_table(
                    [(str(metric.get("label") or "Metric"), str(metric.get("value") or "—")) for metric in metrics],
                    styles,
                    content_width,
                )
            )

        bullets = cast(List[str], section.get("bullets") or [])
        for bullet in bullets:
            story.append(Paragraph(pdf_text(f"• {bullet}"), styles["ReportBullet"]))

    def _build_pdf_metric_table(
        self,
        metric_cards: Sequence[tuple[str, str]],
        styles: Dict[str, Any],
        content_width: float,
    ) -> Any:
        label_width = min(52 * mm, content_width * 0.4)
        value_width = max(content_width - label_width, 48 * mm)
        table = Table(
            [
                [
                    Paragraph(pdf_text(label), styles["ReportMetricLabel"]),
                    Paragraph(pdf_text(value), styles["ReportMetricValue"]),
                ]
                for label, value in metric_cards
            ],
            colWidths=[label_width, value_width],
            hAlign="LEFT",
        )
        table.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f7fbfc")),
                    ("BOX", (0, 0), (-1, -1), 0.75, colors.HexColor("#d9e2e6")),
                    ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#d9e2e6")),
                    ("LEFTPADDING", (0, 0), (-1, -1), 8),
                    ("RIGHTPADDING", (0, 0), (-1, -1), 8),
                    ("TOPPADDING", (0, 0), (-1, -1), 7),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
                ]
            )
        )
        return table

    def _draw_pdf_footer(self, canvas: Any, document: Any) -> None:
        canvas.saveState()
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(colors.HexColor("#56717c"))
        canvas.drawRightString(document.pagesize[0] - document.rightMargin, 8 * mm, f"Page {canvas.getPageNumber()}")
        canvas.restoreState()