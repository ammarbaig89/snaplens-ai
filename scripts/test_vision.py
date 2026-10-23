import os
import sys
from pathlib import Path
import dotenv
import httpx
import base64

repo_root = Path(r"d:\snaplens\snaplens-ai")
dotenv.load_dotenv(repo_root / ".env")
sys.path.insert(0, str(repo_root))
sys.path.insert(0, str(repo_root / "services" / "vision-service"))

from providers import GEMINI_RESPONSE_SCHEMA, VISION_PROMPT

key = os.getenv("GEMINI_API_KEY")
model = "gemini-3.8-flash"
endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

tiny_jpeg = open(repo_root / "scripts" / "sample.jpg", "rb").read()

payload = {
    "contents": [
        {
            "role": "user",
            "parts": [
                {"text": VISION_PROMPT.format(question='"What is this?"')},
                {
                    "inline_data": {
                        "mime_type": "image/jpeg",
                        "data": base64.b64encode(tiny_jpeg).decode("ascii"),
                    }
                },
            ],
        }
    ],
    "generationConfig": {
        "responseMimeType": "application/json",
        "responseSchema": GEMINI_RESPONSE_SCHEMA,
        "temperature": 0.1,
        "maxOutputTokens": 1024,
        "thinkingConfig": {
            "thinkingBudget": 0
        }
    },
}

with httpx.Client(timeout=30.0) as client:
    r = client.post(endpoint, headers={"x-goog-api-key": key}, json=payload)
    print("STATUS:", r.status_code)
    print("RESPONSE:", r.text)
