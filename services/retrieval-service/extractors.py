"""Bounded text extraction from uploaded HTML and PDF bytes (no URL fetching)."""

from html.parser import HTMLParser
from io import BytesIO
import re

from pypdf import PdfReader

MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
MAX_EXTRACTED_CHARS = 20000
MAX_PDF_PAGES = 25
SUPPORTED_TYPES = {"application/pdf", "text/html"}


class DocumentExtractionError(ValueError):
    def __init__(self, code: str, message: str, status_code: int) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


class _TextOnlyHTMLParser(HTMLParser):
    _SKIP_TAGS = {"script", "style", "noscript", "svg", "template"}
    _BLOCK_TAGS = {
        "address", "article", "br", "div", "footer", "h1", "h2", "h3",
        "h4", "header", "li", "main", "p", "section", "table", "tr",
    }

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self._skip_depth = 0
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs) -> None:
        del attrs
        if tag in self._SKIP_TAGS:
            self._skip_depth += 1
        elif not self._skip_depth and tag in self._BLOCK_TAGS:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in self._SKIP_TAGS and self._skip_depth:
            self._skip_depth -= 1
        elif not self._skip_depth and tag in self._BLOCK_TAGS:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self._skip_depth:
            self.parts.append(data)


def extract_document_text(content: bytes, content_type: str) -> str:
    """Extract readable text from already-provided document bytes."""
    if len(content) > MAX_DOCUMENT_BYTES:
        raise DocumentExtractionError(
            "DOCUMENT_TOO_LARGE", "The document exceeds the 10 MiB limit.", 413
        )
    if not content:
        raise DocumentExtractionError(
            "EMPTY_DOCUMENT", "Upload a non-empty HTML or PDF document.", 422
        )

    media_type = content_type.split(";", 1)[0].strip().lower()
    if media_type not in SUPPORTED_TYPES:
        raise DocumentExtractionError(
            "UNSUPPORTED_DOCUMENT_TYPE",
            "Upload an HTML or PDF document.",
            415,
        )

    try:
        if media_type == "text/html":
            text = _extract_html(content)
        else:
            if not content.startswith(b"%PDF-"):
                raise DocumentExtractionError(
                    "INVALID_DOCUMENT", "The PDF file signature is invalid.", 415
                )
            text = _extract_pdf(content)
    except DocumentExtractionError:
        raise
    except Exception as error:
        raise DocumentExtractionError(
            "DOCUMENT_EXTRACTION_FAILED",
            "The document could not be read safely.",
            422,
        ) from error

    normalized = re.sub(r"[ \t\f\v]+", " ", text)
    normalized = re.sub(r"\s*\n\s*", "\n", normalized).strip()
    normalized = normalized[:MAX_EXTRACTED_CHARS].strip()
    if not normalized:
        raise DocumentExtractionError(
            "NO_EXTRACTABLE_TEXT",
            "No readable text was found in the document.",
            422,
        )
    return normalized


def _extract_html(content: bytes) -> str:
    try:
        html = content.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise DocumentExtractionError(
            "INVALID_DOCUMENT", "The HTML document must use UTF-8 text.", 415
        ) from error
    parser = _TextOnlyHTMLParser()
    parser.feed(html)
    parser.close()
    return " ".join(parser.parts)


def _extract_pdf(content: bytes) -> str:
    reader = PdfReader(BytesIO(content), strict=False)
    if reader.is_encrypted:
        raise DocumentExtractionError(
            "ENCRYPTED_DOCUMENT", "Password-protected PDFs are not supported.", 415
        )
    page_text = []
    for page in reader.pages[:MAX_PDF_PAGES]:
        extracted = page.extract_text()
        if extracted:
            page_text.append(extracted)
        if sum(map(len, page_text)) >= MAX_EXTRACTED_CHARS:
            break
    return "\n".join(page_text)
