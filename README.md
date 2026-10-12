<p align="center">
  <img src="assets/shiba-face.png" width="96" alt="Notchman's Shiba">
</p>

<h1 align="center">Notchman Community</h1>

<p align="center">
  <b>Copy anything. Hear the TL;DR.</b><br>
  A tiny Shiba that lives on your screen and reads you the short version of long posts, messages, articles and AI answers, while you keep working.<br>
  Free for personal use · runs on your computer · your own API keys
</p>

---

## Quick start (2 minutes)

You need [Node.js 20+](https://nodejs.org) and git. Windows and macOS.

```bash
git clone --depth 1 https://github.com/Iamritupatil/notchman-community.git
cd notchman-community
npm install
npm start
```

<details>
<summary>No git, or the clone keeps failing ("early EOF")? Download the ZIP instead</summary>

Windows (PowerShell):

```powershell
Invoke-WebRequest https://github.com/Iamritupatil/notchman-community/archive/refs/heads/main.zip -OutFile notchman-community.zip
Expand-Archive notchman-community.zip -DestinationPath .
cd notchman-community-main
npm install
npm start
```

Mac (Terminal):

```bash
curl -L https://github.com/Iamritupatil/notchman-community/archive/refs/heads/main.zip -o notchman-community.zip
unzip notchman-community.zip && cd notchman-community-main
npm install
npm start
```

Or use a lighter clone: `git clone --depth 1 https://github.com/Iamritupatil/notchman-community.git`
</details>

Notchman opens its Settings the first time: paste a **free Groq API key** from [console.groq.com/keys](https://console.groq.com/keys) and press **Save keys**. That's the only setup.

Then select or copy any text (or a link) and:

| Press | What happens |
| --- | --- |
| **Alt+T** (⌥T on Mac) | TL;DR of what you copied, read aloud |
| **Alt+R** (⌥R on Mac) | Reads it in full |
| Click the Shiba | TL;DR or Read the text you selected |

A small player appears at the top of your screen with play/pause, ±15 seconds and speed. Notchman lives in the tray / menu bar.

## Your keys

| Key | Needed? | What for |
| --- | --- | --- |
| `GROQ_API_KEY` | Yes (free) | Making the TL;DR |
| `ELEVENLABS_API_KEY` | Optional | Natural ElevenLabs voices. Without it, the free [Kokoro](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX) voice runs on your computer. |
| `LLM_BASE_URL`, `LLM_MODEL`, `LLM_API_KEY` | Optional | Use any OpenAI-compatible API instead of Groq: OpenAI, OpenRouter, or a local [Ollama](https://ollama.com) (`http://localhost:11434/v1`, no key) |

Paste them in **Settings → Your API keys** (saved encrypted with your operating system's key store), or copy `.env.example` to `.env`, or set environment variables. Keys never leave your computer except in requests to the provider they belong to. There is no Notchman server in this edition.

## Community vs Pro

| | Community (this repo) | [Notchman Pro](https://notchman.app) |
| --- | :---: | :---: |
| TL;DR of copied or selected text, links and posts | ✅ your key | ✅ |
| Read aloud in full, free on-device voice | ✅ | ✅ |
| Natural ElevenLabs voices | ✅ your key | ✅ included |
| Floating Shiba, shortcuts, player, history | ✅ | ✅ |
| **Pick on screen**: choose any paragraph on screen, no copying | – | ✅ |
| Multi-step TL;DR that checks nothing important was left out | – | ✅ |
| No API keys or setup at all | – | ✅ |
| iPhone app, installers and automatic updates | – | ✅ |

## How it works

```
clipboard / selection ─▶ (link? fetch the page or post) ─▶ TL;DR (Groq, your key)
                                                       ─▶ voice (ElevenLabs, your key ─ or Kokoro on this computer)
                                                       ─▶ the player pill
```

- `src/main.js`: windows, shortcuts, the Shiba, the player
- `src/core/`: reading the clipboard, fetching links, splitting text for speech, the TL;DR client (`byok.js`)
- `src/local-voice.js`, `src/ui/voice.js`: the free Kokoro voice
- `src/ui/`: the Shiba, the player pill and the Notchman window

```bash
npm test     # unit tests
npm run dist # build an installer for your own computer (Windows; dist:mac on a Mac)
```

## Update

```bash
git pull && npm install
```

## Privacy

History and settings stay on your computer. Text you TL;DR goes straight from your computer to Groq (or your AI provider) and, if you added a key, to ElevenLabs. Nothing goes to Notchman.

## License: personal, non-commercial use only

The code is public, but it is **not** free for commercial use. It's licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE):

- ✅ Use it yourself, read it, change it, and share changes for non-commercial use
- ❌ No commercial use of the app or the code: not at a company or business, not in a paid, monetized or hosted product or service, and no selling it

See [NOTICE.md](NOTICE.md) for the plain-words version, and for the Notchman name and Shiba artwork (not licensed for other use). For commercial use, use [Notchman Pro](https://notchman.app) or write to ritu@miniclayai.com.

Made by [Ritu Patil](https://notchman.app). Issues and ideas welcome.
