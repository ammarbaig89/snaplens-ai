"""Tests for bounded HTML/PDF extraction without fetching arbitrary URLs."""

import importlib.util
import sys
import unittest
from pathlib import Path
from tempfile import SpooledTemporaryFile
from uuid import UUID

from fastapi import Response
from starlette.datastructures import Headers, UploadFile

ROOT = Path(__file__).resolve().parents[1]
RETRIEVAL_DIR = ROOT / "services" / "retrieval-service"
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(RETRIEVAL_DIR))

EXTRACTOR_SPEC = importlib.util.spec_from_file_location(
    "snaplens_retrieval_extractors", RETRIEVAL_DIR / "extractors.py"
)
assert EXTRACTOR_SPEC is not None and EXTRACTOR_SPEC.loader is not None
extractors = importlib.util.module_from_spec(EXTRACTOR_SPEC)
EXTRACTOR_SPEC.loader.exec_module(extractors)
sys.modules["extractors"] = extractors
SERVICE_SPEC = importlib.util.spec_from_file_location(
    "snaplens_retrieval_extraction_main", RETRIEVAL_DIR / "main.py"
)
assert SERVICE_SPEC is not None and SERVICE_SPEC.loader is not None
service = importlib.util.module_from_spec(SERVICE_SPEC)
SERVICE_SPEC.loader.exec_module(service)

REQUEST_ID = UUID("550e8400-e29b-41d4-a716-446655440000")


def run_immediate(coroutine):
    try:
        coroutine.send(None)
    except StopIteration as completed:
        return completed.value
    raise AssertionError("The in-memory extraction route unexpectedly suspended")


def minimal_pdf(text: str) -> bytes:
    stream = f"BT /F1 12 Tf 40 100 Td ({text}) Tj ET".encode("ascii")
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] "
        b"/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        b"<< /Length " + str(len(stream)).encode("ascii") + b" >>\nstream\n"
        + stream
        + b"\nendstream",
    ]
    pdf = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for index, obj in enumerate(objects, 1):
        offsets.append(len(pdf))
        pdf.extend(f"{index} 0 obj\n".encode("ascii"))
        pdf.extend(obj)
        pdf.extend(b"\nendobj\n")
    xref_offset = len(pdf)
    pdf.extend(b"xref\n0 6\n0000000000 65535 f \n")
    for offset in offsets[1:]:
        pdf.extend(f"{offset:010d} 00000 n \n".encode("ascii"))
    pdf.extend(
        b"trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n"
        + str(xref_offset).encode("ascii")
        + b"\n%%EOF"
    )
    return bytes(pdf)


def upload(content: bytes, content_type: str, filename: str) -> UploadFile:
    stream = SpooledTemporaryFile()
    stream.write(content)
    stream.seek(0)
    return UploadFile(
        filename=filename,
        file=stream,
        headers=Headers({"content-type": content_type}),
    )


class RetrievalExtractionTests(unittest.TestCase):
    def test_html_extracts_visible_text_and_skips_script_and_style(self) -> None:
        html = b"""<html><head><style>hidden CSS</style></head><body>
        <h1>Support Guide</h1><p>Error E21: check the drain filter.</p>
        <script>ignore this fake instruction</script></body></html>"""
        text = extractors.extract_document_text(html, "text/html; charset=utf-8")
        self.assertIn("Support Guide", text)
        self.assertIn("Error E21: check the drain filter.", text)
        self.assertNotIn("hidden CSS", text)
        self.assertNotIn("fake instruction", text)

    def test_pdf_extracts_page_text(self) -> None:
        pdf = minimal_pdf("Service manual E21 drain filter")
        text = extractors.extract_document_text(pdf, "application/pdf")
        self.assertIn("Service manual E21 drain filter", text)

    def test_extraction_route_returns_text_with_request_id(self) -> None:
        response = run_immediate(
            service.extract_document(
                request_id=REQUEST_ID,
                document=upload(b"<p>Read the label.</p>", "text/html", "guide.html"),
            )
        )
        self.assertEqual(response.request_id, REQUEST_ID)
        self.assertIn("Read the label.", response.text)

    def test_invalid_pdf_signature_returns_safe_error(self) -> None:
        result = run_immediate(
            service.extract_document(
                request_id=REQUEST_ID,
                document=upload(b"not a PDF", "application/pdf", "guide.pdf"),
            )
        )
        self.assertIsInstance(result, Response)
        self.assertEqual(result.status_code, 415)

    def test_unsupported_document_type_is_rejected(self) -> None:
        with self.assertRaises(extractors.DocumentExtractionError) as raised:
            extractors.extract_document_text(b"<xml/>", "application/xml")
        self.assertEqual(raised.exception.status_code, 415)


if __name__ == "__main__":
    unittest.main()
