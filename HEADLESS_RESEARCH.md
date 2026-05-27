# Headless iMessage-UI Video Rendering — Research Report

**Date:** 2026-05-26
**Context:** AI Council TikTok videos — produce MP4 showing iPhone-style iMessage interface (bubbles, typing indicators, reactions) from `chat.json` input, running entirely on a headless Linux VM.

---

## 1. Options Analysis

### 1.1 Remotion (React → MP4 via Puppeteer/Chrome Headless Shell)

**How it works:** Write a React component that renders the full iMessage UI (chat bubbles, typing indicators, reactions, status bar). Remotion bundles it, launches Chrome Headless Shell (bundled binary, auto-installs), renders each frame via CDP, and stitches to MP4 via FFmpeg. API: `renderMedia()` from `@remotion/renderer`.

**Headless?** ✅ Yes — Chrome Headless Shell ships with Remotion; no display required. Linux fully supported (Ubuntu 24.04+ needs `apt install` of ~15 shared libs). Alpine/nixOS unsupported.

**Linux?** ✅ Yes — explicit Linux support. Dependencies documented and minimal.

**Cost:**  
- **Free** for individuals, non-profits, and companies ≤3 people.  
- **$25/mo per seat** (Remotion for Creators) for 4+ person teams.  
- **$0.01/render, $100/mo min** (Remotion for Automators) for automated pipelines.  
- This project appears to be ≤3 people → **free**.

**Quality:** ⭐⭐⭐⭐⭐ — Pixel-perfect. Renders exactly what the React component produces at any resolution. GPU acceleration optional (Chrome for Testing mode). CSS animations, SVG, Canvas — everything works. Full 60fps capability.

**Speed:** ⭐⭐⭐ — CPU-bound. Each frame requires a browser render + screenshot. Simple 2D UI like iMessage is fast (~5-15 fps render time for 30s video = 2-10 min). But pipeline is mature and reliable.

**Production-Ready:** ✅ Yes — battle-tested at scale. Used by VidLab, Clideo, Typeform, and many more. Remotion Lambda for serverless.

**iMessage-Custom-UI:** ✅ Excellent — you build the React component yourself. Full control over bubble styling, typing dots, reactions, avatars, animations, scroll behavior. The existing `public/script.js` and `public/style.css` and `public/index.html` can be ported directly to Remotion components. The Remotion template `prompt-to-motion-graphics-saas` already includes a **"messaging" skill** with WhatsApp/iMessage styling patterns.

**Verdict:** Strongest candidate for the "proper" solution.

---

### 1.2 cutcli (CapCut Draft CLI + Cloud Render)

**How it works:** `cutcli` is a Go CLI that creates standard CapCut draft folders from commands/JSON. Drafts can be opened in CapCut Desktop to render, OR uploaded to cutcli.com's cloud renderer (`cutcli cloud render`). No CapCut Desktop needed for cloud rendering.

**Headless?** ✅ Cloud render is headless. Draft creation is headless. But:  
- **Local rendering** requires CapCut Desktop (Windows/macOS).  
- **Cloud rendering** requires API key, internet, and **pay-per-render**.  
- Cloud infrastructure may or may not support custom UI templates beyond what cutcli exposes (captions, images, video, audio, effects, stickers, keyframes, masks — no custom HTML/CSS rendering).

**Linux?** ✅ Binary available for Linux (cross-platform).

**Cost:** cutcli cloud render pricing is **not publicly published** — the docs mention an API key model but no per-render or per-minute costs visible. Requires investigation or contacting the team.

**Quality:** ⭐⭐⭐⭐ — CapCut's render engine is production-grade. But you're limited to CapCut's element types. Building a pixel-perfect iMessage UI from scratch using only captions, stickers, and keyframes would be extremely painful and fragile.

**Speed:** ⭐⭐⭐⭐ — Cloud render likely fast (GPU-accelerated). Draft creation instant.

**Production-Ready:** ✅ Yes for the tool, ❌ **No for iMessage UI** — building an iMessage chat interface from CapCut primitives would be nearly impossible at the fidelity needed (bubble shapes, typing dots animation, reaction effects, scroll behavior).

**iMessage-Custom-UI:** ❌ — cutcli supports caption text, images, video, effects. It does NOT support embedding custom HTML/CSS/JS. You'd need to pre-render each bubble as an image and composite them, which defeats the purpose.

**Verdict:** Niche for CapCut-native workflows. Not suitable for iMessage UI.

---

### 1.3 ashreo/CapCutAPI (Python CapCut Automation)

**How it works:** Python HTTP server/MCP server that automates CapCut Desktop via its internal API. Requires CapCut Desktop (Windows/macOS) running alongside the server.

**Headless?** ❌ **Requires CapCut Desktop** (Windows/macOS app running with GUI). Not headless. Not Linux-compatible.

**Linux?** ❌ No — requires Windows/macOS with CapCut installed.

**Cost:** Free / Apache 2.0.

**Quality:** ⭐⭐⭐ — depends on CapCut's render quality.

**Speed:** ⭐⭐⭐ — depends on local CapCut.

**Production-Ready:** ❌ — No headless support, requires CapCut GUI, not production-viable for server automation.

**iMessage-Custom-UI:** ❌ — Same limitation as cutcli: limited to CapCut element types.

**Verdict:** Eliminated. Not headless, not Linux.

---

### 1.4 Pixi.js + node-canvas → FFmpeg

**How it works:** Use Pixi.js (WebGL 2D renderer) on node-canvas (Cairo-backed Canvas API) in Node.js. Render each frame programmatically: draw the iMessage UI state for that frame timestamp, extract pixel data from the canvas, pipe raw frames to FFmpeg stdin as a rawvideo stream or image sequence.

**Headless?** ✅ Yes — `konva-node` / `node-canvas` / bare `canvas` API all run without any display server. No X11, no Wayland, no virtual framebuffer needed.

**Linux?** ✅ Yes — `node-canvas` uses Cairo, which is a system library on Linux. `apt install libcairo2-dev` is the main dependency.

**Cost:** Free — all open source (MIT/BSD). Zero licensing.

**Quality:** ⭐⭐⭐⭐ — Vector-perfect. Pixi.js or Konva give you full control over shape rendering, text, animations, and compositing. Performance is CPU-bound but for 2D chat UI it's very efficient. Downside: no CSS — you build everything with canvas draw calls or Konva nodes. Text rendering via node-canvas is high quality but limited compared to browser text layout.

**Speed:** ⭐⭐⭐⭐ — Node-canvas rendering is fast (~10-30 fps render speed for simple 2D scenes). The LeanyLabs blog reports ~6 fps for complex Konva scenes, but iMessage bubbles are much simpler. No browser overhead. Can pipe directly to FFmpeg rawvideo for maximum efficiency.

**Production-Ready:** ✅ Yes — proven pattern (Konva + node-canvas + FFmpeg used in production at LeanyLabs). But requires building the entire iMessage UI rendering engine from Canvas primitives — no CSS, no HTML, no layout engine.

**iMessage-Custom-UI:** ⭐⭐⭐ — Full control but you build from scratch. Bubble shapes (rounded rects with tails), typing dots, reactions, scroll behavior — all hand-coded in canvas draw calls. Feasible but significant engineering effort.

**Verdict:** Strong alternative. Best performance profile. But high build effort for UI fidelity.

---

### 1.5 Python Pillow / MoviePy → Manual Frame Compositing

**How it works:** Use Pillow to draw each frame as an image (bubble shapes, text, avatars, reactions). Compose frames into video with MoviePy (Python wrapper around FFmpeg). Frame-by-frame rendering.

**Headless?** ✅ Yes — pure Python, no display needed.

**Linux?** ✅ Yes — Pillow and MoviePy work perfectly on Linux.

**Cost:** Free — MIT/BSD licensed.

**Quality:** ⭐⭐⭐ — Pillow's text rendering is decent but limited compared to browser/Canvas. Kerning, emoji rendering, and complex text layout are weak points. Bubble shapes need manual bezier curve drawing. Animations require manual interpolation math. Acceptable for simple styles but won't match the fidelity of a browser-rendered solution. Emoji support in particular is poor with stock Pillow.

**Speed:** ⭐⭐ — Python image-by-image rendering is slow. Pillow is not hardware-accelerated. Expect 1-5 fps render speed. A 30s 60fps video = 1800 frames = potentially 10-30 minutes.

**Production-Ready:** ⭐⭐ — Possible but not ideal for high-volume or high-fidelity output. No existing iMessage rendering libraries found. Would be a large bespoke build.

**iMessage-Custom-UI:** ⭐⭐ — Possible but tedious. No existing libraries. Emoji rendering is a major headache. Animations require manual tweening. Bubble tail curves require bezier math.

**Verdict:** Last resort. Only viable for very simple / lo-fi output where quality doesn't matter.

---

### 1.6 HTML-based: Puppeteer/Playwright Screenshot → FFmpeg

**How it works:** This is the **current approach** in `record_mac.js` — serve a static HTML page with the iMessage UI, use Chrome CDP screencast to stream JPEG frames to FFmpeg via pipe.

**Headless?** ✅ Yes — Puppeteer/Playwright with headless Chrome work on Linux. The current code uses `headless: 'new'` and a persistent cache directory, and works on Linux.

**Linux?** ✅ Yes — the existing approach **already works on Linux** with minor adjustments (the `record_mac.js` is Mac-named but is just Node.js + Puppeteer, which runs on Linux).

**Cost:** Free — Puppeteer/Chromium are BSD/Chromium licensed.

**Quality:** ⭐⭐⭐⭐⭐ — Same pixel-perfect browser rendering as Remotion. CSS, emoji, SVG, Canvas, animation — everything renders natively.

**Speed:** ⭐⭐⭐ — Same as Remotion: browser overhead for each frame. But the current approach uses a live screencast (CDP `Page.startScreencast`) which is **realtime** — it records at wall-clock speed. This means a 20-second video takes 20 seconds to record. That's actually *faster* than Remotion's frame-by-frame render for simple content, but the framerate can dip if the browser can't keep up with 60fps rendering.

**Production-Ready:** ⭐⭐⭐ — The current approach works but has issues:
- CDP screencast framerate is variable (depends on content changes)
- Static screens (intro/outro) produce few frames, requiring wall-clock frame duplication (already handled in `record_mac.js`)
- No audio support in the current pipeline
- No built-in error recovery
- Relies on polling `window.__IM_DONE__` rather than deterministic timing

**iMessage-Custom-UI:** ✅ Excellent — **this is exactly what the current project does**. The existing `public/index.html`, `public/style.css`, and `public/script.js` already render a full iMessage UI with typing indicators, reactions, avatars, and scroll behavior. It just needs to be made more reliable and deterministic on Linux.

**Verdict:** **The pragmatic winner for "first publishable clips."** Already works, runs on Linux, uses the existing codebase. Needs refinement but is the fastest path to production.

---

### 1.7 JSON2Video API (Paid API Service)

**How it works:** REST API where you define scenes with elements (text, images, video, audio, **HTML**). Render happens on their cloud infrastructure. Supports custom HTML/CSS/JS elements — you can embed an entire iMessage UI in an `<iframe>`-like HTML element.

**Headless?** ✅ Yes — API-based. No local rendering.

**Linux?** ✅ Yes — it's an API. Any platform can call it.

**Cost:**  
- Free: 600 credits (watermarked, for evaluation)  
- Paid: $16.95/mo (3,000 credits = 50 min video) to $99.95/mo (30,000 credits = 500 min video)  
- 1 credit = 1 second of HD video. 4K is 4x.  
- A 20-second TikTok would cost ~20 credits ($0.01-0.02).

**Quality:** ⭐⭐⭐⭐ — Cloud renderer uses professional encoding. HTML elements are rendered with headless Chrome (similar to Remotion/Puppeteer approach). Supports fade, keyframe animation, chroma-key, etc.

**Speed:** ⭐⭐⭐⭐ — Cloud render is fast (<2 min typical, per their claims). No local CPU usage.

**Production-Ready:** ✅ Yes — 10M+ videos created, 99.9% uptime. Support for webhooks, templates, variables.

**iMessage-Custom-UI:** ⭐⭐⭐⭐⭐ **in theory** — The HTML element type supports arbitrary HTML5/CSS3/JS + Tailwind. You could build the entire iMessage UI as an HTML string and pass it in the API call. However, the HTML element is likely rendered as a static screenshot (with `wait` parameter for JS execution time) — complex animations (typing dots, staggered bubble appearances, reaction effects) may not work reliably in a single screenshot. The scene-based timeline could animate elements sequentially, but this is designed for declarative scenes, not a dynamic JS-driven chat animation.

**Verdict:** Viable but uncertain for complex animations. Has a monthly cost. Good for simple "static screenshot of a chat" but the dynamic timeline animation is the question mark.

---

### 1.8 OpenClaw Video Generation

**How it works:** OpenClaw agents can generate videos via 16 provider backends (Google Veo, Runway Gen-4.5, Sora, MiniMax, etc.). Supports text-to-video, image-to-video, and video-to-video.

**Headless?** ✅ Yes — API-based, all providers are cloud APIs.

**Linux?** ✅ Yes — API-based.

**Cost:** Provider-dependent. Most are pay-per-generation:
- Google Veo / Runway / Sora: $0.10-$0.50 per 5-second clip
- MiniMax / Kling: similar range

**Quality:** ⭐⭐⭐ — AI video generation quality has improved dramatically but still suffers from:
- Inconsistent physics/coherence in complex scenes
- Can't reliably generate specific UI text or UI elements
- No control over exact pixel positions or typography

**Speed:** ⭐⭐ — Generations take 30s to several minutes, and you'd likely need multiple takes to get a usable result.

**Production-Ready:** ❌ — AI video generation cannot produce a pixel-perfect iMessage UI with specific text content. It's designed for cinematic/creative content, not UI mockups.

**iMessage-Custom-UI:** ❌ — Impossible. AI video models can't render specific UI text, bubble positions, or chat layouts on demand. Even image-to-video with a reference image would drift and hallucinate text.

**Verdict:** Not applicable. Wrong tool for the job.

---

## 2. Decision Matrix

| Option | Headless | Linux | Cost | Quality | Speed | Production-Ready | iMessage-Custom-UI | Recommendation |
|---|---|---|---|---|---|---|---|---|
| **1. Remotion** | ✅ Yes | ✅ Yes | Free (≤3ppl) / $25/mo | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ (CPU-bound) | ✅ Yes | ✅✅ Full control via React | **🏆 WINNER (proper)** |
| **2. cutcli** | ✅ Cloud | ✅ Yes | Unknown/unpublished | ⭐⭐⭐ (CapCut) | ⭐⭐⭐⭐ (Cloud GPU) | ❌ No for UI | ❌ No custom UI | Eliminated |
| **3. CapCutAPI** | ❌ Requires GUI | ❌ No | Free (Apache 2.0) | ⭐⭐⭐ | ⭐⭐⭐ | ❌ No for UI | ❌ No custom UI | Eliminated |
| **4. Pixi/Konva+node-canvas→FFmpeg** | ✅ Yes | ✅ Yes | Free | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ (Fast, CPU) | ✅ Yes (proven) | ⭐⭐⭐ (build from scratch) | **🥈 Strong alt.** |
| **5. Pillow/MoviePy** | ✅ Yes | ✅ Yes | Free | ⭐⭐ | ⭐⭐ (Slow) | ⭐⭐ (Possible) | ⭐⭐ (Tedious, emoji issues) | Last resort |
| **6. Puppeteer/Playwright→FFmpeg** | ✅ Yes | ✅ Yes | Free | ⭐⭐⭐⭐⭐ | ⭐⭐⭐ (Realtime) | ⭐⭐⭐ (Current, needs refinement) | ✅✅✅ **Already built!** | **🏆 WINNER (pragmatic)** |
| **7. JSON2Video API** | ✅ Yes | ✅ Yes | $16.95-99.95/mo | ⭐⭐⭐⭐ | ⭐⭐⭐⭐ (Cloud) | ✅ Yes | ⭐⭐⭐ (HTML elem, uncertain for anim) | Viable fallback |
| **8. OpenClaw Video Gen** | ✅ Yes | ✅ Yes | Per-gen ($0.10-0.50) | ⭐⭐ (AI drift) | ⭐⭐ (Slow gens) | ❌ No | ❌ Impossible | Eliminated |

---

## 3. Winner Recommendation

### 🏆 Production Winner: **Remotion**

Build a proper Remotion project that:
1. Takes `chat.json` as input props
2. Has a React component rendering the full iMessage UI (iPhone frame, status bar, header, chat bubbles with tails, typing indicators, reactions, scroll behavior)
3. Uses `renderMedia()` to produce 1080×1920 MP4 at 60fps
4. Runs headless on Linux via Chrome Headless Shell

**Why:** Pixel-perfect fidelity, full control, free license for this team size, excellent documentation, existing "messaging" skill in remotion-dev/template-prompt-to-motion-graphics-saas, and React component architecture is clean and maintainable.

**Build effort:** 2-5 days to port the existing HTML/CSS/JS UI to Remotion components and wire up the rendering pipeline.

---

### 🏆 Pragmatic/Immediate Winner: **Puppeteer/Playwright Screencast → FFmpeg**

The existing `record_mac.js` already works on Linux. Refinements needed:
1. Make `record_mac.js` Linux-compatible (it already mostly is — just Node.js + Puppeteer)
2. Add deterministic timing instead of polling `__IM_DONE__`
3. Add audio support (voiceover, text-to-speech)
4. Add proper error recovery and monitoring
5. Package as a CLI tool: `imessage-tiktok render --input chat.json --output video.mp4`

**Why:** Zero new architecture. Uses the existing battle-tested UI code. Gets you publishable clips *today*. Can be replaced by Remotion later when quality requirements grow.

**Build effort:** 1-2 days for production hardening + CLI packaging.

---

### Quick-start recommendation based on your timeline:

| Timeline | Recommended Path |
|---|---|
| **This week** | Harden `record_mac.js` → Linux headless pipeline → ship clips |
| **This month** | Build Remotion project for better reliability, audio, and deterministic rendering |
| **If both fail** | JSON2Video API as paid fallback (but test HTML element animation support first) |

---

## 4. Key Technical Notes

### Remotion iMessage Component Architecture (suggested)
```
Remotion Root/
├── src/
│   ├── Root.tsx              # Entry: reads compositon props (chat.json data)
│   ├── iMessage/
│   │   ├── PhoneFrame.tsx    # iPhone bezel, notch, status bar
│   │   ├── ChatHeader.tsx    # Group name, avatar, back/call buttons
│   │   ├── ChatContainer.tsx # Scrollable message area with fade edges
│   │   ├── ChatBubble.tsx    # Bubble shape (left/right), tail, text
│   │   ├── Avatar.tsx        # Agent avatar circle
│   │   ├── TypingIndicator.tsx # Animated typing dots
│   │   ├── MessageRow.tsx    # Avatar + Name + Bubble + FX container
│   │   ├── Reactions.tsx     # Burst, sparkle, confetti, shake effects
│   │   └── InputArea.tsx     # Bottom input bar
│   ├── hooks/
│   │   ├── useChatTiming.ts  # Delay calculation from chat.json timing
│   │   └── useAutoScroll.ts  # rAF-based scroll tracking
│   ├── types.ts              # ChatJSON, Agent, Message interfaces
│   └── config.ts             # Styling constants
├── remotion.config.ts
└── package.json
```

### Puppeteer Pipeline (existing, needs Linux hardening)
```javascript
// Key changes needed in record_mac.js for Linux production:
// 1. Detect platform: use system Chrome on macOS, Chromium on Linux
// 2. Add `--no-sandbox` flag for Linux headless
// 3. Add audio capture: use `page.evaluate()` to play/record Web Audio API
// 4. Use `waitForFunction(__IM_DONE__)` instead of polling
// 5. Add proper progress logging and error recovery
```

### Dependencies check for this Linux VM
```bash
# For Remotion:
apt install -y libnss3 libdbus-1-3 libatk1.0-0 libasound2t64 libxrandr2 \
  libxkbcommon-dev libxfixes3 libxcomposite1 libxdamage1 libgbm-dev \
  libcups2 libcairo2 libpango-1.0-0 libatk-bridge2.0-0

# For Puppeteer (same deps + Chromium):
npx puppeteer browsers install chrome

# For node-canvas (Option 4):
apt install -y libcairo2-dev libpango1.0-dev libjpeg-dev libgif-dev librsvg2-dev
```
