"""Deepgram Voice Agent configuration for the SnapLens mobile assistant."""

import json
import os


MAX_VOICE_SESSION_SECONDS = max(
    60, int(os.getenv("VOICE_ASSISTANT_MAX_SESSION_SECONDS", "600"))
)

ASSISTANT_PROMPT = """You are SnapLens, a concise voice assistant inside the SnapLens AI mobile app.
Help users understand the app and operate its supported screens by calling the
provided functions. App sections are Home, Diagnose, Activity, Guide, Settings,
and About. Settings includes Gateway connection status, privacy information,
and the Light, Ocean, Graphite, Signal, Violet, and Arctic glass themes.
Diagnosis requires a photo and a question; it uses the
existing SnapLens diagnosis workflow and returns cited troubleshooting guidance.

Use only the provided functions to change app state or start a diagnosis. Never
claim an action succeeded until its function returns success. If a photo is
missing, ask the user to take or choose one; do not invent visual details. Read
diagnosis guidance in short, safe steps. Mention that sources are visible on the
result screen rather than reading long URLs aloud. Do not suggest opening or
repairing energized equipment; ask the user to stop and seek qualified help
when a task may be dangerous. Keep listening for follow-up requests until the
user ends the assistant session. If asked to turn off voice mode, call
end_voice_assistant and give a brief goodbye."""


APP_FUNCTIONS = [
    {
        "name": "navigate_to_screen",
        "description": "Open a SnapLens screen requested by the user.",
        "parameters": {
            "type": "object",
            "properties": {
                "screen": {
                    "type": "string",
                    "enum": ["home", "diagnose", "activity", "guide", "settings", "about"],
                    "description": "The screen to open.",
                }
            },
            "required": ["screen"],
        },
        "defer_until_eot": True,
    },
    {
        "name": "start_new_diagnosis",
        "description": "Clear the current photo, question, and result, then open a fresh diagnosis flow.",
        "parameters": {"type": "object", "properties": {}},
        "defer_until_eot": True,
    },
    {
        "name": "check_gateway_connection",
        "description": "Check whether SnapLens can reach its API Gateway right now.",
        "parameters": {"type": "object", "properties": {}},
        "defer_until_eot": True,
    },
    {
        "name": "set_appearance_theme",
        "description": "Change SnapLens's glass appearance theme when the user asks.",
        "parameters": {
            "type": "object",
            "properties": {
                "theme": {
                    "type": "string",
                    "enum": ["light", "ocean", "graphite", "signal", "violet", "arctic"],
                    "description": "The requested theme ID.",
                }
            },
            "required": ["theme"],
        },
        "defer_until_eot": True,
    },
    {
        "name": "take_troubleshooting_photo",
        "description": "Open the phone camera so the user can take a troubleshooting photo.",
        "parameters": {"type": "object", "properties": {}},
        "defer_until_eot": True,
    },
    {
        "name": "choose_troubleshooting_photo",
        "description": "Open the photo library so the user can select a troubleshooting photo.",
        "parameters": {"type": "object", "properties": {}},
        "defer_until_eot": True,
    },
    {
        "name": "run_photo_diagnosis",
        "description": "Analyze the currently selected photo using the user's question and return grounded, cited guidance. Use only when the user requests an analysis and a photo is selected.",
        "parameters": {
            "type": "object",
            "properties": {
                "question": {
                    "type": "string",
                    "description": "The user's troubleshooting question, kept concise.",
                }
            },
            "required": ["question"],
        },
        "defer_until_eot": True,
    },
    {
        "name": "open_diagnosis_source",
        "description": "Open a numbered source citation from the current diagnosis result.",
        "parameters": {
            "type": "object",
            "properties": {
                "source_number": {
                    "type": "integer",
                    "minimum": 1,
                    "description": "One-based citation number shown on the diagnosis result.",
                }
            },
            "required": ["source_number"],
        },
        "defer_until_eot": True,
    },
    {
        "name": "end_voice_assistant",
        "description": "Turn off the current voice session after confirming the user wants to stop voice mode.",
        "parameters": {"type": "object", "properties": {}},
        "defer_until_eot": True,
    },
]


def voice_assistant_settings() -> str:
    """Build provider settings from server-only environment variables."""
    settings = {
        "type": "Settings",
        "audio": {
            "input": {"encoding": "linear16", "sample_rate": 16000},
            "output": {
                "encoding": "linear16",
                "sample_rate": 24000,
                "container": "none",
            },
        },
        "agent": {
            "language": os.getenv("DEEPGRAM_VOICE_LANGUAGE", "en"),
            "greeting": os.getenv(
                "DEEPGRAM_VOICE_GREETING",
                "Hi, I'm SnapLens. I can help you use the app or troubleshoot a photo. What would you like to do?",
            ),
            "listen": {
                "provider": {
                    "type": "deepgram",
                    "model": os.getenv("DEEPGRAM_LISTEN_MODEL", "flux-general-en"),
                }
            },
            "think": {
                "provider": {
                    "type": os.getenv("DEEPGRAM_THINK_PROVIDER", "open_ai"),
                    "model": os.getenv("DEEPGRAM_THINK_MODEL", "gpt-4o-mini"),
                    "temperature": float(os.getenv("DEEPGRAM_THINK_TEMPERATURE", "0.3")),
                },
                "prompt": ASSISTANT_PROMPT,
                "functions": APP_FUNCTIONS,
            },
            "speak": {
                "provider": {
                    "type": "deepgram",
                    "model": os.getenv("DEEPGRAM_SPEAK_MODEL", "aura-2-thalia-en"),
                }
            },
        },
    }
    return json.dumps(settings)
